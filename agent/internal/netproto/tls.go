package netproto

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"math/big"
	"os"
	"path/filepath"
	"time"

	"github.com/ParsaFathii/MeshSync/agent/internal/identity"
)

// MeshSync peer connections use TLS 1.3 with self-signed certificates whose
// only accepted key material is the device's Ed25519 identity key. Identity
// is therefore proven by the TLS handshake itself: whoever completes the
// handshake owns the private key matching the pinned public key.

// EnsureCert loads or creates the self-signed peer certificate in stateDir.
func EnsureCert(stateDir string, id *identity.Identity) (tls.Certificate, error) {
	certPath := filepath.Join(stateDir, "peer-cert.pem")
	keyPath := filepath.Join(stateDir, "peer-key.pem")
	if cert, err := tls.LoadX509KeyPair(certPath, keyPath); err == nil {
		// verify it still matches the identity key
		if len(cert.Certificate) > 0 {
			if leaf, err := x509.ParseCertificate(cert.Certificate[0]); err == nil {
				if pub, ok := leaf.PublicKey.(ed25519.PublicKey); ok && pub.Equal(id.Pub) {
					return cert, nil
				}
			}
		}
	}
	// (re)generate
	der, err := selfSignCert(id)
	if err != nil {
		return tls.Certificate{}, err
	}
	keyPEM, err := identity.EncodePrivateKeyPEM(id.Priv)
	if err != nil {
		return tls.Certificate{}, err
	}
	certPEM := pemEncode("CERTIFICATE", der)
	if err := os.WriteFile(certPath, certPEM, 0o600); err != nil {
		return tls.Certificate{}, err
	}
	if err := os.WriteFile(keyPath, keyPEM, 0o600); err != nil {
		return tls.Certificate{}, err
	}
	return tls.X509KeyPair(certPEM, keyPEM)
}

func selfSignCert(id *identity.Identity) ([]byte, error) {
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 120))
	if err != nil {
		return nil, err
	}
	tmpl := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: id.PeerID},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().AddDate(10, 0, 0),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth, x509.ExtKeyUsageClientAuth},
		BasicConstraintsValid: true,
	}
	return x509.CreateCertificate(rand.Reader, tmpl, tmpl, id.Pub, id.Priv)
}

// PeerIDFromCert extracts the peer id (SHA-256 of the certificate's public
// key, first 8 bytes hex) from a verified TLS state.
func PeerIDFromCert(cs tls.ConnectionState) (string, error) {
	id, _, err := PeerIdentityFromCert(cs)
	return id, err
}

// PeerIdentityFromCert returns both the peer id and the Ed25519 public key
// from the peer's self-signed certificate.
func PeerIdentityFromCert(cs tls.ConnectionState) (string, ed25519.PublicKey, error) {
	if len(cs.PeerCertificates) == 0 {
		return "", nil, errors.New("no peer certificate")
	}
	leaf := cs.PeerCertificates[0]
	pub, ok := leaf.PublicKey.(ed25519.PublicKey)
	if !ok {
		return "", nil, errors.New("peer certificate key is not Ed25519")
	}
	// enforce self-signature: the certificate must be signed by its own key
	if !ed25519.Verify(pub, leaf.RawTBSCertificate, leaf.Signature) {
		return "", nil, errors.New("certificate is not self-signed")
	}
	sum := sha256.Sum256(pub)
	return hex.EncodeToString(sum[:8]), pub, nil
}

// ServerTLSConfig accepts any self-signed Ed25519 certificate; trust
// decisions happen AFTER the handshake using the extracted peer id.
// RequireAnyClientCert makes the client always present its identity
// certificate so PeerIdentityFromCert can pin it post-handshake.
func ServerTLSConfig(cert tls.Certificate) *tls.Config {
	return &tls.Config{
		Certificates: []tls.Certificate{cert},
		MinVersion:   tls.VersionTLS13,
		ClientAuth:   tls.RequireAnyClientCert,
		// identity is pinned post-handshake via PeerIDFromCert
		InsecureSkipVerify: true,
	}
}

// ClientTLSConfig pins the expected peer public key. When expectedPub is
// nil (pairing to an unknown device) any self-signed Ed25519 cert is
// accepted so the key can be learned and shown to the user.
func ClientTLSConfig(cert tls.Certificate, expectedPub ed25519.PublicKey) *tls.Config {
	return &tls.Config{
		Certificates:       []tls.Certificate{cert},
		MinVersion:         tls.VersionTLS13,
		InsecureSkipVerify: true,
		VerifyPeerCertificate: func(rawCerts [][]byte, _ [][]*x509.Certificate) error {
			if len(rawCerts) == 0 {
				return errors.New("no peer certificate")
			}
			leaf, err := x509.ParseCertificate(rawCerts[0])
			if err != nil {
				return err
			}
			pub, ok := leaf.PublicKey.(ed25519.PublicKey)
			if !ok {
				return errors.New("peer key is not Ed25519")
			}
			if !ed25519.Verify(pub, leaf.RawTBSCertificate, leaf.Signature) {
				return errors.New("peer certificate is not self-signed")
			}
			if expectedPub != nil && !pub.Equal(expectedPub) {
				return errors.New("peer key does not match pinned identity")
			}
			return nil
		},
	}
}

func pemEncode(blockType string, der []byte) []byte {
	return pem.EncodeToMemory(&pem.Block{Type: blockType, Bytes: der})
}
