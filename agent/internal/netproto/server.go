package netproto

import (
	"context"
	"crypto/ed25519"
	"crypto/tls"
	"net"
	"sync"
	"time"

	"github.com/ParsaFathii/MeshSync/agent/internal/store"
)

// Handler receives every decoded peer message on the server side. The
// server owns the read loop; handlers must not block for long (transfer
// serving runs on its own connections).
type Handler interface {
	// TrustState returns the local trust for a connecting peer id, plus the
	// pinned public key when known (empty when unknown).
	TrustState(peerID string) (store.PeerTrust, ed25519.PublicKey, bool)
	// OnHello records an announcement; returns the reply HELLO.
	OnHello(c *Conn, h *Hello) (*Hello, error)
	// OnPairRequest handles a pairing handshake. The returned decision is
	// sent back automatically.
	OnPairRequest(c *Conn, pr *PairRequest) PairDecision
	// OnPairApproved marks the sender as trusted (they approved us).
	OnPairApproved(c *Conn) error
	// ServeGetChunk reads a chunk from local disk and this default server
	// implementation streams it.
	OnGetChunk(c *Conn, g *GetChunk) error
	// OnPutChunk handles an incoming chunk write.
	OnPutChunk(c *Conn, h *ChunkHeader, data []byte) (*ChunkAck, error)
	// OnDelete applies a remote deletion with hash safety.
	OnDelete(c *Conn, d *DeleteFile) error
	// OnAdopt records that the remote side adopted our version.
	OnAdopt(c *Conn, a *Adopt) error
	// OnConflictNotify mirrors a detected conflict.
	OnConflictNotify(c *Conn, n *ConflictNotify) error
	// OnSyncBegin announces a session; sender manifest included.
	OnSyncBegin(c *Conn, s *SyncBegin, senderManifest *Index) error
	// OnSyncEnd closes a session on the receiver side.
	OnSyncEnd(c *Conn, s *SyncEnd) error
	// OnFileBegin/OnFileEnd/OnProgress maintain passive-side transfer records.
	OnFileBegin(c *Conn, f *FileBegin) error
	OnFileEnd(c *Conn, f *FileEnd) error
	OnProgress(c *Conn, p *TransferProgress) error
	// ManifestFor serves this device's file index for a folder.
	ManifestFor(folderName string) (*Index, error)
	// OnPeerGone is called when a connection drops (post-HELLO only).
	OnPeerGone(peerID string)
}

type PairDecision int

const (
	PairDecisionPending PairDecision = iota
	PairDecisionApproved
	PairDecisionRejected
)

// Server listens for peer connections.
type Server struct {
	ln      net.Listener
	cert    tls.Certificate
	handler Handler
	wg      sync.WaitGroup
	quit    chan struct{}
}

func NewServer(addr string, cert tls.Certificate, h Handler) (*Server, error) {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, err
	}
	return &Server{ln: ln, cert: cert, handler: h, quit: make(chan struct{})}, nil
}

func (s *Server) Addr() string { return s.ln.Addr().String() }

func (s *Server) Serve() error {
	for {
		nc, err := s.ln.Accept()
		if err != nil {
			select {
			case <-s.quit:
				return nil
			default:
				return err
			}
		}
		s.wg.Add(1)
		go s.handle(nc)
	}
}

func (s *Server) Close() {
	close(s.quit)
	s.ln.Close()
	s.wg.Wait()
}

func (s *Server) handle(nc net.Conn) {
	defer s.wg.Done()
	tc := tls.Server(nc, ServerTLSConfig(s.cert))
	tc.SetDeadline(time.Now().Add(15 * time.Second))
	if err := tc.HandshakeContext(context.Background()); err != nil {
		nc.Close()
		return
	}
	peerID, pub, err := PeerIdentityFromCert(tc.ConnectionState())
	if err != nil {
		tc.Close()
		return
	}
	trust, pinned, known := s.handler.TrustState(peerID)
	if known {
		// identity keys must never silently change for a known peer
		if len(pinned) > 0 && !pub.Equal(pinned) {
			c := WrapConn(tc)
			_ = c.SendError("IDENTITY_MISMATCH", "peer identity key changed; remove and re-pair this device")
			c.CloseNow()
			return
		}
		if trust == store.Revoked {
			c := WrapConn(tc)
			_ = c.SendError("REVOKED", "this device has revoked your access")
			c.CloseNow()
			return
		}
	}
	c := WrapConn(tc)
	// handlers identify the sender through the conn's remote info
	c.SetRemoteInfo(PeerInfo{PeerID: peerID})
	s.serveLoop(c, peerID, trust)
}

// serveLoop reads frames until BYE or error. Pairing requests from unknown
// peers are allowed; sync traffic requires TRUSTED.
func (s *Server) serveLoop(c *Conn, peerID string, trust store.PeerTrust) {
	helloDone := false
	defer func() {
		if helloDone {
			s.handler.OnPeerGone(peerID)
		}
		c.CloseNow()
	}()
	for {
		c.SetDeadline(time.Now().Add(90 * time.Second))
		t, payload, err := c.ReadMsg()
		if err != nil {
			return
		}
		switch t {
		case MsgBye:
			return
		case MsgHello:
			var h Hello
			if err := DecodeJSON(payload, &h); err != nil {
				return
			}
			if h.PeerID != peerID {
				_ = c.SendError("IDENTITY_MISMATCH", "certificate identity does not match HELLO")
				return
			}
			reply, err := s.handler.OnHello(c, &h)
			if err != nil {
				_ = c.SendError("HELLO_FAILED", err.Error())
				return
			}
			if err := c.WriteJSON(MsgHello, reply); err != nil {
				return
			}
			helloDone = true
			trust, _, _ = s.handler.TrustState(peerID) // refresh after possible pairing
		case MsgPairRequest:
			var pr PairRequest
			if err := DecodeJSON(payload, &pr); err != nil {
				return
			}
			if pr.PeerID != peerID {
				_ = c.SendError("IDENTITY_MISMATCH", "certificate identity does not match pair request")
				return
			}
			switch s.handler.OnPairRequest(c, &pr) {
			case PairDecisionApproved:
				_ = c.WriteJSON(MsgPairApproved, PairApprovedBody{})
			case PairDecisionRejected:
				_ = c.WriteJSON(MsgPairRejected, PairRejected{Reason: "pairing rejected by this device"})
				return
			default:
				_ = c.WriteJSON(MsgPairPending, PairPending{Message: "pairing request recorded; waiting for approval"})
			}
		default:
			if !helloDone {
				_ = c.SendError("PROTOCOL", "expected HELLO first")
				return
			}
			if t == MsgPairApproved && trust != store.Trusted {
				// explicit approval notification from a peer we asked to pair
				// with: the sender's key is proven by the TLS handshake.
				if err := s.handler.OnPairApproved(c); err != nil {
					_ = c.SendError("PAIR_ERROR", err.Error())
				} else {
					trust, _, _ = s.handler.TrustState(peerID)
				}
				continue
			}
			if trust != store.Trusted {
				_ = c.SendError("NOT_TRUSTED", "peer is not trusted; approve the pairing first")
				return
			}
			if !s.dispatch(c, t, payload) {
				return
			}
		}
	}
}

// dispatch returns false when the connection should close.
func (s *Server) dispatch(c *Conn, t MsgType, payload []byte) bool {
	switch t {
	case MsgIndex:
		// unsolicited manifest announcement: cache it as remote state
		var idx Index
		if err := DecodeJSON(payload, &idx); err != nil {
			return false
		}
		if err := s.handler.OnSyncBegin(c, &SyncBegin{Folder: idx.Folder}, &idx); err != nil {
			_ = c.SendError("SYNC_ERROR", err.Error())
		}
	case MsgIndexRequest:
		var req IndexRequest
		if err := DecodeJSON(payload, &req); err != nil {
			return false
		}
		idx, err := s.handler.ManifestFor(req.Folder)
		if err != nil {
			_ = c.SendError("FOLDER_NOT_FOUND", err.Error())
			return true
		}
		if err := c.WriteJSON(MsgIndex, idx); err != nil {
			return false
		}
	case MsgGetChunk:
		var g GetChunk
		if err := DecodeJSON(payload, &g); err != nil {
			return false
		}
		if err := s.handler.OnGetChunk(c, &g); err != nil {
			_ = c.SendError("IO_ERROR", err.Error())
		}
	case MsgPutChunk:
		h, data, err := DecodeChunkFrame(payload)
		if err != nil {
			return false
		}
		ack, err := s.handler.OnPutChunk(c, h, data)
		if err == nil && ack != nil {
			if err := c.WriteJSON(MsgChunkAck, ack); err != nil {
				return false
			}
		} else {
			_ = c.WriteJSON(MsgChunkAck, &ChunkAck{Folder: h.Folder, Path: h.Path, Offset: h.Offset, Ok: false, Error: err.Error()})
		}
	case MsgDeleteFile:
		var d DeleteFile
		if err := DecodeJSON(payload, &d); err != nil {
			return false
		}
		if err := s.handler.OnDelete(c, &d); err != nil {
			_ = c.SendError("IO_ERROR", err.Error())
		}
	case MsgAdopt:
		var a Adopt
		if err := DecodeJSON(payload, &a); err != nil {
			return false
		}
		if err := s.handler.OnAdopt(c, &a); err != nil {
			_ = c.SendError("IO_ERROR", err.Error())
		}
	case MsgConflictNotify:
		var n ConflictNotify
		if err := DecodeJSON(payload, &n); err != nil {
			return false
		}
		if err := s.handler.OnConflictNotify(c, &n); err != nil {
			_ = c.SendError("IO_ERROR", err.Error())
		}
	case MsgSyncBegin:
		var sb SyncBegin
		if err := DecodeJSON(payload, &sb); err != nil {
			return false
		}
		// sender's manifest follows as a separate INDEX frame
		t2, p2, err := c.ReadMsg()
		if err != nil || t2 != MsgIndex {
			return false
		}
		var senderManifest Index
		if err := DecodeJSON(p2, &senderManifest); err != nil {
			return false
		}
		if err := s.handler.OnSyncBegin(c, &sb, &senderManifest); err != nil {
			_ = c.SendError("SYNC_ERROR", err.Error())
		}
	case MsgSyncEnd:
		var se SyncEnd
		if err := DecodeJSON(payload, &se); err != nil {
			return false
		}
		_ = s.handler.OnSyncEnd(c, &se)
	case MsgFileBegin:
		var f FileBegin
		if err := DecodeJSON(payload, &f); err != nil {
			return false
		}
		if err := s.handler.OnFileBegin(c, &f); err != nil {
			_ = c.SendError("SYNC_ERROR", err.Error())
		}
	case MsgFileEnd:
		var f FileEnd
		if err := DecodeJSON(payload, &f); err != nil {
			return false
		}
		_ = s.handler.OnFileEnd(c, &f)
	case MsgTransferProgress:
		var p TransferProgress
		if err := DecodeJSON(payload, &p); err != nil {
			return false
		}
		_ = s.handler.OnProgress(c, &p)
	case MsgPing:
		var p Ping
		if err := DecodeJSON(payload, &p); err == nil {
			_ = c.WriteJSON(MsgPong, Pong{TS: p.TS})
		}
	default:
		return false
	}
	return true
}

// PairApprovedBody is the payload for MsgPairApproved.
type PairApprovedBody struct {
	Approved bool `json:"approved"`
}
