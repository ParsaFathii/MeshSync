package app

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
)

func hexOfHash(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func newTransferID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return "t-" + hex.EncodeToString(b)
}

func marshalBeacon(b beacon) []byte {
	raw, err := json.Marshal(b)
	if err != nil {
		return nil
	}
	return raw
}

func unmarshalBeacon(raw []byte, b *beacon) error {
	return json.Unmarshal(raw, b)
}
