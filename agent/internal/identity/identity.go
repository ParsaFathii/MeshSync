// Package identity manages the persistent cryptographic identity of a
// MeshSync device. Each agent instance generates an Ed25519 key pair on
// first start and keeps it in its state directory. The peer ID is derived
// from the public key, so it is stable across restarts and cannot be
// spoofed without the private key.
package identity

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

type Identity struct {
	Priv ed25519.PrivateKey
	Pub  ed25519.PublicKey
	// PeerID is the first 16 hex characters of SHA-256(public key).
	PeerID string
	// Fingerprint is a human-checkable string of the same digest.
	Fingerprint string
}

// Load reads the identity key from stateDir, creating a fresh one when none
// exists yet. The key file is created with 0600 permissions.
func Load(stateDir string) (*Identity, error) {
	path := filepath.Join(stateDir, "identity.key")
	if _, err := os.Stat(path); err == nil {
		raw, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("read identity key: %w", err)
		}
		if len(raw) != ed25519.PrivateKeySize {
			return nil, errors.New("identity key has wrong size")
		}
		return fromPrivate(ed25519.PrivateKey(raw)), nil
	}

	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("generate identity key: %w", err)
	}
	if err := os.WriteFile(path, priv, 0o600); err != nil {
		return nil, fmt.Errorf("persist identity key: %w", err)
	}
	return fromPrivate(priv), nil
}

func fromPrivate(priv ed25519.PrivateKey) *Identity {
	pub := priv.Public().(ed25519.PublicKey)
	sum := sha256.Sum256(pub)
	id := &Identity{
		Priv:        priv,
		Pub:         pub,
		PeerID:      hex.EncodeToString(sum[:8]),
		Fingerprint: "SHA256:" + base64.RawStdEncoding.EncodeToString(sum[:]),
	}
	return id
}

// EncodePublicKey returns the public key as lowercase hex.
func (i *Identity) EncodePublicKey() string {
	return hex.EncodeToString(i.Pub)
}

// DecodePublicKey parses a hex-encoded Ed25519 public key.
func DecodePublicKey(s string) (ed25519.PublicKey, error) {
	raw, err := hex.DecodeString(s)
	if err != nil || len(raw) != ed25519.PublicKeySize {
		return nil, errors.New("invalid public key")
	}
	return ed25519.PublicKey(raw), nil
}

// Sign returns a signature over msg using the identity key.
func (i *Identity) Sign(msg []byte) []byte { return ed25519.Sign(i.Priv, msg) }

// Verify checks a signature made by another device's identity key.
func Verify(pub ed25519.PublicKey, msg, sig []byte) bool {
	return ed25519.Verify(pub, msg, sig)
}

// PEM helpers are used for the self-signed TLS certificate, never for the
// identity key itself (which is stored raw for simplicity and robustness).

func EncodePrivateKeyPEM(priv ed25519.PrivateKey) ([]byte, error) {
	der, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		return nil, err
	}
	return pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}), nil
}
