// Package netproto defines the MeshSync peer wire protocol: length-prefixed
// frames over TLS 1.3, with identity pinned to each device's Ed25519 key.
//
// Frame layout: [4-byte big-endian length][1-byte type][payload]
// CHUNK_DATA / PUT_CHUNK payloads are [2-byte header length][JSON header][raw bytes].
package netproto

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
)

const (
	maxFrameSize = 17 * 1024 * 1024 // 16 MiB chunk + header room
)

type MsgType byte

const (
	MsgHello MsgType = iota + 1
	MsgIndexRequest
	MsgIndex
	MsgError
	MsgGetChunk
	MsgChunkData
	MsgPutChunk
	MsgChunkAck
	MsgDeleteFile
	MsgAdopt
	MsgPairRequest
	MsgPairApproved
	MsgPairRejected
	MsgPairPending
	MsgPing
	MsgPong
	MsgBye
	MsgConflictNotify
	MsgSyncBegin
	MsgSyncEnd
	MsgFileBegin
	MsgFileEnd
	MsgTransferProgress
)

func (t MsgType) String() string {
	names := map[MsgType]string{
		MsgHello: "HELLO", MsgIndexRequest: "INDEX_REQUEST", MsgIndex: "INDEX",
		MsgError: "ERROR", MsgGetChunk: "GET_CHUNK", MsgChunkData: "CHUNK_DATA",
		MsgPutChunk: "PUT_CHUNK", MsgChunkAck: "CHUNK_ACK", MsgDeleteFile: "DELETE_FILE",
		MsgAdopt: "ADOPT", MsgPairRequest: "PAIR_REQUEST", MsgPairApproved: "PAIR_APPROVED",
		MsgPairRejected: "PAIR_REJECTED", MsgPairPending: "PAIR_PENDING", MsgPing: "PING",
		MsgPong: "PONG", MsgBye: "BYE", MsgConflictNotify: "CONFLICT_NOTIFY",
		MsgSyncBegin: "SYNC_BEGIN", MsgSyncEnd: "SYNC_END", MsgFileBegin: "FILE_BEGIN",
		MsgFileEnd: "FILE_END", MsgTransferProgress: "TRANSFER_PROGRESS",
	}
	if n, ok := names[t]; ok {
		return n
	}
	return fmt.Sprintf("MSG_%d", byte(t))
}

// ---- JSON message bodies ----

type Hello struct {
	PeerID   string   `json:"peerId"`
	Name     string   `json:"name"`
	Version  string   `json:"version"`
	Platform string   `json:"platform"`
	Folders  []string `json:"folders"`
	// Listen is the sender's peer TCP port. It lets the receiving side
	// record a dialable address instead of the ephemeral source port.
	Listen int `json:"listen,omitempty"`
	// TrustYou is true when the sender already trusts the recipient.
	TrustYou bool `json:"trustYou,omitempty"`
}

type IndexRequest struct {
	Folder string `json:"folder"`
}

type ManifestEntry struct {
	Path           string `json:"path"`
	Size           int64  `json:"size"`
	Mtime          int64  `json:"mtime"`
	Hash           string `json:"hash"`
	Deleted        bool   `json:"deleted"`
	LastSyncedHash string `json:"lastSyncedHash,omitempty"`
}

type Index struct {
	Folder string          `json:"folder"`
	Files  []ManifestEntry `json:"files"`
}

type WireError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type GetChunk struct {
	Folder string `json:"folder"`
	Path   string `json:"path"`
	Offset int64  `json:"offset"`
	Length int64  `json:"length"`
}

// ChunkHeader describes the binary payload following it.
type ChunkHeader struct {
	Folder   string `json:"folder"`
	Path     string `json:"path"`
	Offset   int64  `json:"offset"`
	Length   int64  `json:"length"`
	Hash     string `json:"hash"`     // sha256 of this chunk
	FileHash string `json:"fileHash"` // sha256 of the whole file
	FileSize int64  `json:"fileSize"`
	Mtime    int64  `json:"mtime"` // remote mtime to preserve
}

type ChunkAck struct {
	Folder   string `json:"folder"`
	Path     string `json:"path"`
	Offset   int64  `json:"offset"`
	FileDone bool   `json:"fileDone,omitempty"`
	Ok       bool   `json:"ok"`
	Error    string `json:"error,omitempty"`
}

type DeleteFile struct {
	Folder       string `json:"folder"`
	Path         string `json:"path"`
	ExpectedHash string `json:"expectedHash"` // receiver only deletes when this matches its current hash
}

type Adopt struct {
	Folder string `json:"folder"`
	Path   string `json:"path"`
	Hash   string `json:"hash"`
}

type PairRequest struct {
	PeerID   string `json:"peerId"`
	Name     string `json:"name"`
	Version  string `json:"version"`
	Platform string `json:"platform"`
}

type PairRejected struct {
	Reason string `json:"reason"`
}

type PairPending struct {
	Message string `json:"message"`
}

type Ping struct {
	TS int64 `json:"ts"`
}

type Pong struct {
	TS       int64    `json:"ts"`
	PeerID   string   `json:"peerId"`
	Name     string   `json:"name"`
	Version  string   `json:"version"`
	Platform string   `json:"platform"`
	Folders  []string `json:"folders"`
}

type ConflictNotify struct {
	Folder      string `json:"folder"`
	Path        string `json:"path"`
	RemoteHash  string `json:"remoteHash"`
	RemoteSize  int64  `json:"remoteSize"`
	RemoteMtime int64  `json:"remoteMtime"`
	RemoteName  string `json:"remoteName"`
}

type SyncBegin struct {
	SessionID string `json:"sessionId"`
	Folder    string `json:"folder"`
}

type SyncEnd struct {
	SessionID   string `json:"sessionId"`
	OK          bool   `json:"ok"`
	Error       string `json:"error,omitempty"`
	Transferred int64  `json:"transferred"`
	Files       int    `json:"files"`
}

type FileBegin struct {
	SessionID string `json:"sessionId"`
	Folder    string `json:"folder"`
	Path      string `json:"path"`
	Hash      string `json:"hash"`
	Size      int64  `json:"size"`
	ChunkSize int64  `json:"chunkSize"`
	Direction string `json:"direction"` // PUSH|PULL from the SENDER of this message's perspective
	// Backup asks the receiving side to move any existing copy of the file
	// to its trash before replacing it (used by conflict resolutions).
	Backup bool `json:"backup,omitempty"`
}

type FileEnd struct {
	SessionID string `json:"sessionId"`
	Folder    string `json:"folder"`
	Path      string `json:"path"`
	Hash      string `json:"hash"`
	OK        bool   `json:"ok"`
	Error     string `json:"error,omitempty"`
}

type TransferProgress struct {
	SessionID   string `json:"sessionId"`
	Folder      string `json:"folder"`
	Path        string `json:"path"`
	Transferred int64  `json:"transferred"`
}

// ---- frame codec ----

// WriteFrame writes one frame. Payload may be nil (empty).
func WriteFrame(w io.Writer, t MsgType, payload []byte) error {
	head := make([]byte, 5)
	binary.BigEndian.PutUint32(head[0:4], uint32(len(payload))+1)
	head[4] = byte(t)
	if _, err := w.Write(head); err != nil {
		return err
	}
	if len(payload) > 0 {
		if _, err := w.Write(payload); err != nil {
			return err
		}
	}
	return nil
}

// ReadFrame reads one frame, enforcing the size limit. Returns the message
// type and payload. io.EOF means the peer closed the connection.
func ReadFrame(r io.Reader) (MsgType, []byte, error) {
	var head [5]byte
	if _, err := io.ReadFull(r, head[:]); err != nil {
		return 0, nil, err
	}
	n := binary.BigEndian.Uint32(head[0:4])
	if n == 0 || n > maxFrameSize {
		return 0, nil, fmt.Errorf("invalid frame length %d", n)
	}
	t := MsgType(head[4])
	payload := make([]byte, n-1)
	if _, err := io.ReadFull(r, payload); err != nil {
		return 0, nil, err
	}
	return t, payload, nil
}

// EncodeJSON is a helper for JSON message bodies.
func EncodeJSON(v any) ([]byte, error) { return json.Marshal(v) }

func DecodeJSON(payload []byte, v any) error { return json.Unmarshal(payload, v) }

// EncodeChunkFrame packs a ChunkHeader plus raw data into a frame payload.
func EncodeChunkFrame(header *ChunkHeader, data []byte) ([]byte, error) {
	hj, err := json.Marshal(header)
	if err != nil {
		return nil, err
	}
	if len(hj) > 65535 {
		return nil, fmt.Errorf("chunk header too large")
	}
	buf := make([]byte, 2+len(hj)+len(data))
	binary.BigEndian.PutUint16(buf[0:2], uint16(len(hj)))
	copy(buf[2:], hj)
	copy(buf[2+len(hj):], data)
	return buf, nil
}

// DecodeChunkFrame unpacks a CHUNK_DATA / PUT_CHUNK payload.
func DecodeChunkFrame(payload []byte) (*ChunkHeader, []byte, error) {
	if len(payload) < 2 {
		return nil, nil, fmt.Errorf("short chunk frame")
	}
	hl := binary.BigEndian.Uint16(payload[0:2])
	if int(2+hl) > len(payload) {
		return nil, nil, fmt.Errorf("truncated chunk header")
	}
	var h ChunkHeader
	if err := json.Unmarshal(payload[2:2+hl], &h); err != nil {
		return nil, nil, err
	}
	return &h, payload[2+hl:], nil
}
