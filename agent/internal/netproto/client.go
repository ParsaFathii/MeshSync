package netproto

import (
	"context"
	"crypto/ed25519"
	"crypto/tls"
	"fmt"
	"net"
	"time"
)

// Dial opens a TLS connection to a peer and performs the HELLO exchange.
// expectedPub may be nil for pairing to unknown devices (key learned from
// the certificate, verified to be self-signed).
func Dial(address string, cert tls.Certificate, self *Hello, expectedPub ed25519.PublicKey, timeout time.Duration) (*Conn, *Hello, error) {
	d := net.Dialer{Timeout: timeout}
	nc, err := d.Dial("tcp", address)
	if err != nil {
		return nil, nil, err
	}
	tc := tls.Client(nc, ClientTLSConfig(cert, expectedPub))
	tc.SetDeadline(time.Now().Add(timeout))
	if err := tc.HandshakeContext(context.Background()); err != nil {
		nc.Close()
		return nil, nil, fmt.Errorf("tls handshake: %w", err)
	}
	remotePeerID, err := PeerIDFromCert(tc.ConnectionState())
	if err != nil {
		tc.Close()
		return nil, nil, err
	}
	c := WrapConn(tc)
	if err := c.WriteJSON(MsgHello, self); err != nil {
		c.CloseNow()
		return nil, nil, err
	}
	var rh Hello
	if err := c.ReadJSON(MsgHello, &rh); err != nil {
		c.CloseNow()
		return nil, nil, err
	}
	if rh.PeerID != remotePeerID {
		c.CloseNow()
		return nil, nil, fmt.Errorf("peer id mismatch: cert %s, hello %s", remotePeerID, rh.PeerID)
	}
	c.SetDeadline(time.Time{})
	c.SetRemoteInfo(PeerInfo{
		PeerID: rh.PeerID, Name: rh.Name, Version: rh.Version,
		Platform: rh.Platform, Folders: rh.Folders, TrustYou: rh.TrustYou,
	})
	return c, &rh, nil
}

// SendPairRequest performs the pairing handshake on an existing dialed
// connection. Returns the decision.
func SendPairRequest(c *Conn, pr *PairRequest) (PairDecision, error) {
	if err := c.WriteJSON(MsgPairRequest, pr); err != nil {
		return PairDecisionRejected, err
	}
	t, payload, err := c.ReadMsg()
	if err != nil {
		return PairDecisionRejected, err
	}
	switch t {
	case MsgPairApproved:
		return PairDecisionApproved, nil
	case MsgPairRejected:
		var r PairRejected
		_ = DecodeJSON(payload, &r)
		return PairDecisionRejected, fmt.Errorf("rejected: %s", r.Reason)
	case MsgPairPending:
		return PairDecisionPending, nil
	case MsgError:
		var e WireError
		_ = DecodeJSON(payload, &e)
		return PairDecisionRejected, fmt.Errorf("%s: %s", e.Code, e.Message)
	default:
		return PairDecisionRejected, fmt.Errorf("unexpected reply %s", t)
	}
}

// SendPairApproved tells a peer that we approved them.
func SendPairApproved(c *Conn) error {
	return c.WriteJSON(MsgPairApproved, PairApprovedBody{Approved: true})
}

// PingRoundTrip measures a quick PING/PONG exchange.
func PingRoundTrip(c *Conn) (time.Duration, error) {
	start := time.Now()
	if err := c.WriteJSON(MsgPing, Ping{TS: start.UnixMilli()}); err != nil {
		return 0, err
	}
	t, _, err := c.ReadMsg()
	if err != nil {
		return 0, err
	}
	if t != MsgPong {
		return 0, fmt.Errorf("expected PONG, got %s", t)
	}
	return time.Since(start), nil
}
