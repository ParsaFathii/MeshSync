package netproto

import (
	"bufio"
	"crypto/ed25519"
	"crypto/tls"
	"encoding/hex"
	"fmt"
	"net"
	"sync"
	"time"
)

// Conn is a framed, TLS-authenticated peer connection. Writes are
// serialized; reads happen in the owning goroutine.
type Conn struct {
	raw    net.Conn
	tls    *tls.Conn
	br     *bufio.Reader
	wmu    sync.Mutex
	remote PeerInfo
	closed bool
}

// PeerInfo describes the verified remote identity after the handshake +
// HELLO exchange.
type PeerInfo struct {
	PeerID   string
	Name     string
	Version  string
	Platform string
	Folders  []string
	TrustYou bool
}

// WrapConn adopts a live TLS connection.
func WrapConn(tc *tls.Conn) *Conn {
	return &Conn{tls: tc, br: bufio.NewReaderSize(tc, 128*1024)}
}

func (c *Conn) SetRemoteInfo(p PeerInfo)             { c.remote = p }
func (c *Conn) RemoteInfo() PeerInfo                 { return c.remote }
func (c *Conn) RemoteAddr() string                   { return c.tls.RemoteAddr().String() }
func (c *Conn) PeerIDFromHandshake() (string, error) { return PeerIDFromCert(c.tls.ConnectionState()) }

// RemotePubkeyHex returns the verified remote identity public key as hex.
func (c *Conn) RemotePubkeyHex() (string, error) {
	cs := c.tls.ConnectionState()
	if len(cs.PeerCertificates) == 0 {
		return "", fmt.Errorf("no peer certificate")
	}
	leaf := cs.PeerCertificates[0]
	pub, ok := leaf.PublicKey.(ed25519.PublicKey)
	if !ok {
		return "", fmt.Errorf("peer key is not Ed25519")
	}
	return hex.EncodeToString(pub), nil
}

func (c *Conn) WriteMsg(t MsgType, payload []byte) error {
	c.wmu.Lock()
	defer c.wmu.Unlock()
	return WriteFrame(c.tls, t, payload)
}

func (c *Conn) WriteJSON(t MsgType, v any) error {
	raw, err := EncodeJSON(v)
	if err != nil {
		return err
	}
	return c.WriteMsg(t, raw)
}

func (c *Conn) ReadMsg() (MsgType, []byte, error) {
	return ReadFrame(c.br)
}

func (c *Conn) ReadJSON(t MsgType, v any) error {
	got, payload, err := c.ReadMsg()
	if err != nil {
		return err
	}
	if got != t {
		return fmt.Errorf("expected %s, got %s", t, got)
	}
	return DecodeJSON(payload, v)
}

func (c *Conn) SetDeadline(d time.Time) error { return c.tls.SetDeadline(d) }

// Close sends BYE first when possible, then closes the socket.
func (c *Conn) Close() {
	if c.closed {
		return
	}
	c.closed = true
	_ = c.WriteJSON(MsgBye, map[string]any{})
	_ = c.tls.Close()
}

func (c *Conn) CloseNow() {
	if c.closed {
		return
	}
	c.closed = true
	_ = c.tls.Close()
}

// SendError transmits a protocol-level error.
func (c *Conn) SendError(code, message string) error {
	return c.WriteJSON(MsgError, WireError{Code: code, Message: message})
}
