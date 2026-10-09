// Package store owns the agent's local SQLite state: peers, trust, shared
// folders, the file index, transfers, conflicts, sessions, events and the
// cached remote manifests. All database access in MeshSync goes through
// this package; nothing else opens the database directly.
package store

import (
	"database/sql"
	"embed"
	"encoding/hex"
	"fmt"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// DB wraps the SQLite handle. modernc.org/sqlite is pure Go, which keeps
// the agent free of cgo and cross-compilable with plain `go build`.
type DB struct {
	mu sync.Mutex // serializes write transactions; reads use the pool
	h  *sql.DB
}

type PeerTrust string

const (
	Discovered PeerTrust = "DISCOVERED"
	Pairing    PeerTrust = "PAIRING"
	Trusted    PeerTrust = "TRUSTED"
	Revoked    PeerTrust = "REVOKED"
)

type Peer struct {
	PeerID   string
	Name     string
	Address  string
	Pubkey   string
	Trust    PeerTrust
	Version  string
	Platform string
	LastSeen int64
	AddedAt  int64
}

type Folder struct {
	ID        int64
	Name      string
	Path      string
	CreatedAt int64
}

type FileEntry struct {
	FolderID       int64
	RelPath        string
	Size           int64
	Mtime          int64
	Hash           string
	LastSyncedHash string
	Deleted        bool
	UpdatedAt      int64
}

type Transfer struct {
	ID          string
	PeerID      string
	FolderID    int64
	RelPath     string
	DestPath    string // write target when it differs from RelPath (keep-both pulls)
	Direction   string // PUSH | PULL
	Size        int64
	FileHash    string
	FileMtime   int64
	Transferred int64
	Status      string // QUEUED PREPARING TRANSFERRING VERIFYING PAUSED COMPLETED FAILED CANCELLED
	ChunkSize   int64
	ChunksTotal int
	ChunksDone  string // hex bitmap, one bit per chunk
	Error       string
	SessionID   string
	StartedAt   int64
	CompletedAt int64
	CreatedAt   int64
}

type Conflict struct {
	ID           int64
	FolderID     int64
	RelPath      string
	LocalHash    string
	RemoteHash   string
	LocalSize    int64
	RemoteSize   int64
	LocalMtime   int64
	RemoteMtime  int64
	RemotePeerID string
	Status       string // OPEN | RESOLVED
	Resolution   string
	CreatedAt    int64
	ResolvedAt   int64
}

type Event struct {
	ID       int64
	Type     string
	Severity string
	Message  string
	Data     string // JSON object or empty
	TS       int64
}

type Session struct {
	ID               string
	PeerID           string
	FolderID         int64
	StartedAt        int64
	FinishedAt       int64
	Status           string
	Transferred      int64
	FilesTransferred int64
	Error            string
}

type RemoteEntry struct {
	PeerID     string
	FolderName string
	RelPath    string
	Hash       string
	Size       int64
	Mtime      int64
	Deleted    bool
	SeenAt     int64
}

func Open(path string) (*DB, error) {
	h, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)")
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	// modernc sqlite is safest with one writer; reads can interleave.
	h.SetMaxOpenConns(4)
	db := &DB{h: h}
	if err := db.migrate(); err != nil {
		h.Close()
		return nil, err
	}
	return db, nil
}

func (d *DB) Close() error { return d.h.Close() }

func (d *DB) migrate() error {
	rows, err := d.h.Query(`SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'`)
	if err != nil {
		return err
	}
	hasTable := rows.Next()
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	if _, err := d.h.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)`); err != nil {
		return err
	}
	if !hasTable {
		// fresh database: apply everything at once
		if _, err := d.h.Exec(`BEGIN`); err != nil {
			return err
		}
	}
	entries, err := migrationsFS.ReadDir("migrations")
	if err != nil {
		return err
	}
	// ReadDir returns sorted filenames.
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		var version int
		if _, err := fmt.Sscanf(e.Name(), "%d_", &version); err != nil {
			return fmt.Errorf("bad migration name %q: %w", e.Name(), err)
		}
		var exists int
		if err := d.h.QueryRow(`SELECT COUNT(*) FROM schema_migrations WHERE version=?`, version).Scan(&exists); err != nil {
			return err
		}
		if exists > 0 {
			continue
		}
		script, err := migrationsFS.ReadFile("migrations/" + e.Name())
		if err != nil {
			return err
		}
		if _, err := d.h.Exec(string(script)); err != nil {
			return fmt.Errorf("apply migration %s: %w", e.Name(), err)
		}
		if _, err := d.h.Exec(`INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)`, version, time.Now().Unix()); err != nil {
			return err
		}
	}
	if !hasTable {
		if _, err := d.h.Exec(`COMMIT`); err != nil {
			return err
		}
	}
	return nil
}

func now() int64 { return time.Now().Unix() }

// ---- meta ----

func (d *DB) GetMeta(key string) (string, bool, error) {
	var v string
	err := d.h.QueryRow(`SELECT value FROM meta WHERE key=?`, key).Scan(&v)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	return v, err == nil, err
}

func (d *DB) SetMeta(key, value string) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	_, err := d.h.Exec(`INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value)
	return err
}

// ---- peers ----

func (d *DB) UpsertDiscoveredPeer(p Peer) (created bool, err error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	var trust string
	err = d.h.QueryRow(`SELECT trust FROM peers WHERE peer_id=?`, p.PeerID).Scan(&trust)
	if err == nil {
		// Refresh announcement data but never downgrade trust state.
		// A newly learned pubkey (pairing) fills an empty value.
		_, err = d.h.Exec(`UPDATE peers SET name=?, address=?, version=?, platform=?, last_seen=?,
                        pubkey=COALESCE(NULLIF(?,''), pubkey) WHERE peer_id=?`,
			p.Name, p.Address, p.Version, p.Platform, p.LastSeen, p.Pubkey, p.PeerID)
		return false, err
	}
	if err != sql.ErrNoRows {
		return false, err
	}
	if p.Trust == "" {
		p.Trust = Discovered
	}
	if p.AddedAt == 0 {
		p.AddedAt = now()
	}
	_, err = d.h.Exec(`INSERT INTO peers(peer_id,name,address,pubkey,trust,version,platform,last_seen,added_at) VALUES(?,?,?,?,?,?,?,?,?)`,
		p.PeerID, p.Name, p.Address, p.Pubkey, string(p.Trust), p.Version, p.Platform, p.LastSeen, p.AddedAt)
	return true, err
}

func (d *DB) SetPeerTrust(peerID string, trust PeerTrust) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	res, err := d.h.Exec(`UPDATE peers SET trust=? WHERE peer_id=?`, string(trust), peerID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("peer %s not found", peerID)
	}
	return nil
}

func (d *DB) UpdatePeerAddress(peerID, address string) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	_, err := d.h.Exec(`UPDATE peers SET address=? WHERE peer_id=?`, address, peerID)
	return err
}

func (d *DB) TouchPeer(peerID string, ts int64) error {
	_, err := d.h.Exec(`UPDATE peers SET last_seen=? WHERE peer_id=?`, ts, peerID)
	return err
}

func (d *DB) DeletePeer(peerID string) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	res, err := d.h.Exec(`DELETE FROM peers WHERE peer_id=?`, peerID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("peer %s not found", peerID)
	}
	_, _ = d.h.Exec(`DELETE FROM remote_manifests WHERE peer_id=?`, peerID)
	return nil
}

func (d *DB) GetPeer(peerID string) (Peer, bool, error) {
	var p Peer
	var trust string
	err := d.h.QueryRow(`SELECT peer_id,name,address,pubkey,trust,version,platform,last_seen,added_at FROM peers WHERE peer_id=?`, peerID).
		Scan(&p.PeerID, &p.Name, &p.Address, &p.Pubkey, &trust, &p.Version, &p.Platform, &p.LastSeen, &p.AddedAt)
	if err == sql.ErrNoRows {
		return p, false, nil
	}
	p.Trust = PeerTrust(trust)
	return p, err == nil, err
}

func (d *DB) ListPeers() ([]Peer, error) {
	rows, err := d.h.Query(`SELECT peer_id,name,address,pubkey,trust,version,platform,last_seen,added_at FROM peers ORDER BY added_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Peer
	for rows.Next() {
		var p Peer
		var trust string
		if err := rows.Scan(&p.PeerID, &p.Name, &p.Address, &p.Pubkey, &trust, &p.Version, &p.Platform, &p.LastSeen, &p.AddedAt); err != nil {
			return nil, err
		}
		p.Trust = PeerTrust(trust)
		out = append(out, p)
	}
	return out, rows.Err()
}

// ---- folders ----

func (d *DB) AddFolder(name, path string) (Folder, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	res, err := d.h.Exec(`INSERT INTO folders(name,path,created_at) VALUES(?,?,?)`, name, path, now())
	if err != nil {
		return Folder{}, err
	}
	id, _ := res.LastInsertId()
	return Folder{ID: id, Name: name, Path: path, CreatedAt: now()}, nil
}

func (d *DB) DeleteFolder(id int64) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	res, err := d.h.Exec(`DELETE FROM folders WHERE id=?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("folder %d not found", id)
	}
	_, _ = d.h.Exec(`DELETE FROM files WHERE folder_id=?`, id)
	return nil
}

func (d *DB) GetFolder(id int64) (Folder, bool, error) {
	var f Folder
	err := d.h.QueryRow(`SELECT id,name,path,created_at FROM folders WHERE id=?`, id).Scan(&f.ID, &f.Name, &f.Path, &f.CreatedAt)
	if err == sql.ErrNoRows {
		return f, false, nil
	}
	return f, err == nil, err
}

func (d *DB) FolderByName(name string) (Folder, bool, error) {
	var f Folder
	err := d.h.QueryRow(`SELECT id,name,path,created_at FROM folders WHERE name=?`, name).Scan(&f.ID, &f.Name, &f.Path, &f.CreatedAt)
	if err == sql.ErrNoRows {
		return f, false, nil
	}
	return f, err == nil, err
}

func (d *DB) ListFolders() ([]Folder, error) {
	rows, err := d.h.Query(`SELECT id,name,path,created_at FROM folders ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Folder
	for rows.Next() {
		var f Folder
		if err := rows.Scan(&f.ID, &f.Name, &f.Path, &f.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// ---- file index ----

func (d *DB) PutFile(e FileEntry) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	_, err := d.h.Exec(`INSERT INTO files(folder_id,rel_path,size,mtime,hash,last_synced_hash,deleted,updated_at)
                VALUES(?,?,?,?,?,?,?,?)
                ON CONFLICT(folder_id,rel_path) DO UPDATE SET
                size=excluded.size, mtime=excluded.mtime, hash=excluded.hash,
                last_synced_hash=excluded.last_synced_hash, deleted=excluded.deleted,
                updated_at=excluded.updated_at`,
		e.FolderID, e.RelPath, e.Size, e.Mtime, e.Hash, e.LastSyncedHash, boolInt(e.Deleted), e.UpdatedAt)
	return err
}

func (d *DB) GetFile(folderID int64, relPath string) (FileEntry, bool, error) {
	var e FileEntry
	var deleted int
	err := d.h.QueryRow(`SELECT folder_id,rel_path,size,mtime,hash,last_synced_hash,deleted,updated_at FROM files WHERE folder_id=? AND rel_path=?`, folderID, relPath).
		Scan(&e.FolderID, &e.RelPath, &e.Size, &e.Mtime, &e.Hash, &e.LastSyncedHash, &deleted, &e.UpdatedAt)
	if err == sql.ErrNoRows {
		return e, false, nil
	}
	e.Deleted = deleted != 0
	return e, err == nil, err
}

func (d *DB) ListFiles(folderID int64) ([]FileEntry, error) {
	rows, err := d.h.Query(`SELECT folder_id,rel_path,size,mtime,hash,last_synced_hash,deleted,updated_at FROM files WHERE folder_id=?`, folderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []FileEntry
	for rows.Next() {
		var e FileEntry
		var deleted int
		if err := rows.Scan(&e.FolderID, &e.RelPath, &e.Size, &e.Mtime, &e.Hash, &e.LastSyncedHash, &deleted, &e.UpdatedAt); err != nil {
			return nil, err
		}
		e.Deleted = deleted != 0
		out = append(out, e)
	}
	return out, rows.Err()
}

func (d *DB) SetFileSynced(folderID int64, relPath, hash string) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	_, err := d.h.Exec(`UPDATE files SET last_synced_hash=?, updated_at=? WHERE folder_id=? AND rel_path=?`, hash, now(), folderID, relPath)
	return err
}

func (d *DB) FolderStats(folderID int64) (files int, bytes int64, lastScan int64, err error) {
	err = d.h.QueryRow(`SELECT COUNT(*), COALESCE(SUM(size),0), COALESCE(MAX(updated_at),0) FROM files WHERE folder_id=? AND deleted=0`, folderID).Scan(&files, &bytes, &lastScan)
	return
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// ---- transfers ----

func (d *DB) PutTransfer(t Transfer) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	_, err := d.h.Exec(`INSERT INTO transfers(id,peer_id,folder_id,rel_path,dest_path,direction,size,file_hash,file_mtime,transferred,status,chunk_size,chunks_total,chunks_done,error,session_id,started_at,completed_at,created_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET
                transferred=excluded.transferred, status=excluded.status,
                chunks_done=excluded.chunks_done, error=excluded.error,
                started_at=excluded.started_at, completed_at=excluded.completed_at,
                session_id=excluded.session_id, size=excluded.size`,
		t.ID, t.PeerID, t.FolderID, t.RelPath, t.DestPath, t.Direction, t.Size, t.FileHash, t.FileMtime, t.Transferred, t.Status,
		t.ChunkSize, t.ChunksTotal, t.ChunksDone, nullStr(t.Error), t.SessionID, zeroInt(t.StartedAt), zeroInt(t.CompletedAt), t.CreatedAt)
	return err
}

func (d *DB) GetTransfer(id string) (Transfer, bool, error) {
	var t Transfer
	var errStr sql.NullString
	var sessionID sql.NullString
	var startedAt, completedAt sql.NullInt64
	err := d.h.QueryRow(`SELECT id,peer_id,folder_id,rel_path,dest_path,direction,size,file_hash,file_mtime,transferred,status,chunk_size,chunks_total,chunks_done,error,session_id,started_at,completed_at,created_at FROM transfers WHERE id=?`, id).
		Scan(&t.ID, &t.PeerID, &t.FolderID, &t.RelPath, &t.DestPath, &t.Direction, &t.Size, &t.FileHash, &t.FileMtime, &t.Transferred, &t.Status, &t.ChunkSize, &t.ChunksTotal, &t.ChunksDone, &errStr, &sessionID, &startedAt, &completedAt, &t.CreatedAt)
	if err == sql.ErrNoRows {
		return t, false, nil
	}
	t.Error = errStr.String
	t.SessionID = sessionID.String
	t.StartedAt = startedAt.Int64
	t.CompletedAt = completedAt.Int64
	return t, err == nil, err
}

func (d *DB) ListTransfers(limit int, status string) ([]Transfer, error) {
	q := `SELECT id,peer_id,folder_id,rel_path,dest_path,direction,size,file_hash,file_mtime,transferred,status,chunk_size,chunks_total,chunks_done,error,session_id,started_at,completed_at,created_at FROM transfers`
	args := []any{}
	if status != "" && status != "ALL" {
		q += ` WHERE status=?`
		args = append(args, status)
	}
	q += ` ORDER BY created_at DESC, id DESC LIMIT ?`
	args = append(args, limit)
	rows, err := d.h.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Transfer
	for rows.Next() {
		var t Transfer
		var errStr sql.NullString
		var sessionID sql.NullString
		var startedAt, completedAt sql.NullInt64
		if err := rows.Scan(&t.ID, &t.PeerID, &t.FolderID, &t.RelPath, &t.DestPath, &t.Direction, &t.Size, &t.FileHash, &t.FileMtime, &t.Transferred, &t.Status, &t.ChunkSize, &t.ChunksTotal, &t.ChunksDone, &errStr, &sessionID, &startedAt, &completedAt, &t.CreatedAt); err != nil {
			return nil, err
		}
		t.Error = errStr.String
		t.SessionID = sessionID.String
		t.StartedAt = startedAt.Int64
		t.CompletedAt = completedAt.Int64
		out = append(out, t)
	}
	return out, rows.Err()
}

// ResetInterruptedTransfers is called at startup: transfers that were
// mid-flight when the process died become PAUSED so the user can resume
// them from the persisted chunk bitmap.
func (d *DB) ResetInterruptedTransfers() (int, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	res, err := d.h.Exec(`UPDATE transfers SET status='PAUSED' WHERE status IN ('QUEUED','PREPARING','TRANSFERRING','VERIFYING')`)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return int(n), nil
}

func (d *DB) DeleteTransfer(id string) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	_, err := d.h.Exec(`DELETE FROM transfers WHERE id=?`, id)
	return err
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func zeroInt(v int64) any {
	if v == 0 {
		return nil
	}
	return v
}

// ---- conflicts ----

func (d *DB) AddConflict(c Conflict) (int64, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	res, err := d.h.Exec(`INSERT INTO conflicts(folder_id,rel_path,local_hash,remote_hash,local_size,remote_size,local_mtime,remote_mtime,remote_peer_id,status,created_at)
                VALUES(?,?,?,?,?,?,?,?,?, 'OPEN', ?)`,
		c.FolderID, c.RelPath, c.LocalHash, c.RemoteHash, c.LocalSize, c.RemoteSize, c.LocalMtime, c.RemoteMtime, c.RemotePeerID, now())
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (d *DB) SetConflictResolution(id int64, resolution string) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	res, err := d.h.Exec(`UPDATE conflicts SET status='RESOLVED', resolution=?, resolved_at=? WHERE id=? AND status='OPEN'`, resolution, now(), id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("open conflict %d not found", id)
	}
	return nil
}

func (d *DB) GetConflict(id int64) (Conflict, bool, error) {
	var c Conflict
	var resolution sql.NullString
	var resolvedAt sql.NullInt64
	err := d.h.QueryRow(`SELECT id,folder_id,rel_path,local_hash,remote_hash,local_size,remote_size,local_mtime,remote_mtime,remote_peer_id,status,resolution,created_at,resolved_at FROM conflicts WHERE id=?`, id).
		Scan(&c.ID, &c.FolderID, &c.RelPath, &c.LocalHash, &c.RemoteHash, &c.LocalSize, &c.RemoteSize, &c.LocalMtime, &c.RemoteMtime, &c.RemotePeerID, &c.Status, &resolution, &c.CreatedAt, &resolvedAt)
	if err == sql.ErrNoRows {
		return c, false, nil
	}
	c.Resolution = resolution.String
	c.ResolvedAt = resolvedAt.Int64
	return c, err == nil, err
}

func (d *DB) ListConflicts(open bool) ([]Conflict, error) {
	q := `SELECT id,folder_id,rel_path,local_hash,remote_hash,local_size,remote_size,local_mtime,remote_mtime,remote_peer_id,status,resolution,created_at,resolved_at FROM conflicts`
	if open {
		q += ` WHERE status='OPEN'`
	}
	q += ` ORDER BY created_at DESC`
	rows, err := d.h.Query(q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Conflict
	for rows.Next() {
		var c Conflict
		var resolution sql.NullString
		var resolvedAt sql.NullInt64
		if err := rows.Scan(&c.ID, &c.FolderID, &c.RelPath, &c.LocalHash, &c.RemoteHash, &c.LocalSize, &c.RemoteSize, &c.LocalMtime, &c.RemoteMtime, &c.RemotePeerID, &c.Status, &resolution, &c.CreatedAt, &resolvedAt); err != nil {
			return nil, err
		}
		c.Resolution = resolution.String
		c.ResolvedAt = resolvedAt.Int64
		out = append(out, c)
	}
	return out, rows.Err()
}

func (d *DB) OpenConflictForFile(folderID int64, relPath, remotePeerID string) (Conflict, bool, error) {
	var c Conflict
	err := d.h.QueryRow(`SELECT id FROM conflicts WHERE folder_id=? AND rel_path=? AND remote_peer_id=? AND status='OPEN'`, folderID, relPath, remotePeerID).Scan(&c.ID)
	if err == sql.ErrNoRows {
		return c, false, nil
	}
	return c, err == nil, err
}

// ---- events ----

func (d *DB) AddEvent(e Event) (int64, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	res, err := d.h.Exec(`INSERT INTO events(type,severity,message,data,ts) VALUES(?,?,?,?,?)`, e.Type, e.Severity, e.Message, nullStr(e.Data), e.TS)
	if err != nil {
		return 0, err
	}
	id, _ := res.LastInsertId()
	// Keep the log bounded.
	if id%500 == 0 {
		_, _ = d.h.Exec(`DELETE FROM events WHERE id < ? - 5000`, id)
	}
	return id, nil
}

func (d *DB) ListEvents(sinceID int64, limit int) ([]Event, error) {
	rows, err := d.h.Query(`SELECT id,type,severity,message,COALESCE(data,''),ts FROM events WHERE id > ? ORDER BY id ASC LIMIT ?`, sinceID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Event
	for rows.Next() {
		var e Event
		if err := rows.Scan(&e.ID, &e.Type, &e.Severity, &e.Message, &e.Data, &e.TS); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// ---- sessions ----

func (d *DB) PutSession(s *Session) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	_, err := d.h.Exec(`INSERT INTO sessions(id,peer_id,folder_id,started_at,finished_at,status,transferred,files_transferred,error)
                VALUES(?,?,?,?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET finished_at=excluded.finished_at, status=excluded.status,
                transferred=excluded.transferred, files_transferred=excluded.files_transferred, error=excluded.error`,
		s.ID, s.PeerID, zeroInt(s.FolderID), s.StartedAt, zeroInt(s.FinishedAt), s.Status, s.Transferred, s.FilesTransferred, nullStr(s.Error))
	return err
}

func (d *DB) ListSessions(limit int) ([]Session, error) {
	rows, err := d.h.Query(`SELECT id,peer_id,folder_id,started_at,finished_at,status,transferred,files_transferred,COALESCE(error,'') FROM sessions ORDER BY started_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Session
	for rows.Next() {
		var s Session
		var peer sql.NullString
		var folder int64
		if err := rows.Scan(&s.ID, &peer, &folder, &s.StartedAt, &s.FinishedAt, &s.Status, &s.Transferred, &s.FilesTransferred, &s.Error); err != nil {
			return nil, err
		}
		s.PeerID = peer.String
		s.FolderID = folder
		out = append(out, s)
	}
	return out, rows.Err()
}

// ---- remote manifests (cache of the peer's index at last exchange) ----

func (d *DB) ReplaceRemoteManifest(peerID, folderName string, entries []RemoteEntry) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	tx, err := d.h.Begin()
	if err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM remote_manifests WHERE peer_id=? AND folder_name=?`, peerID, folderName); err != nil {
		tx.Rollback()
		return err
	}
	stmt, err := tx.Prepare(`INSERT INTO remote_manifests(peer_id,folder_name,rel_path,hash,size,mtime,deleted,seen_at) VALUES(?,?,?,?,?,?,?,?)`)
	if err != nil {
		tx.Rollback()
		return err
	}
	defer stmt.Close()
	ts := now()
	for _, e := range entries {
		if _, err := stmt.Exec(peerID, folderName, e.RelPath, e.Hash, e.Size, e.Mtime, boolInt(e.Deleted), ts); err != nil {
			tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}

func (d *DB) ListRemoteManifest(peerID, folderName string) ([]RemoteEntry, error) {
	rows, err := d.h.Query(`SELECT peer_id,folder_name,rel_path,hash,size,mtime,deleted,seen_at FROM remote_manifests WHERE peer_id=? AND folder_name=?`, peerID, folderName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []RemoteEntry
	for rows.Next() {
		var e RemoteEntry
		var deleted int
		if err := rows.Scan(&e.PeerID, &e.FolderName, &e.RelPath, &e.Hash, &e.Size, &e.Mtime, &deleted, &e.SeenAt); err != nil {
			return nil, err
		}
		e.Deleted = deleted != 0
		out = append(out, e)
	}
	return out, rows.Err()
}

func (d *DB) RemoteEntryFor(peerID, folderName, relPath string) (*RemoteEntry, error) {
	var e RemoteEntry
	var deleted int
	err := d.h.QueryRow(`SELECT peer_id,folder_name,rel_path,hash,size,mtime,deleted,seen_at FROM remote_manifests WHERE peer_id=? AND folder_name=? AND rel_path=?`, peerID, folderName, relPath).
		Scan(&e.PeerID, &e.FolderName, &e.RelPath, &e.Hash, &e.Size, &e.Mtime, &deleted, &e.SeenAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	e.Deleted = deleted != 0
	return &e, nil
}

func (d *DB) PeerRemotePaths(peerID string, hash string) (map[string]bool, error) {
	rows, err := d.h.Query(`SELECT rel_path FROM remote_manifests WHERE peer_id=? AND hash=? AND deleted=0`, peerID, hash)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			return nil, err
		}
		out[p] = true
	}
	return out, rows.Err()
}

// HexBitmap helpers: chunk completion bitmaps persisted with transfers.

func BitmapFromBools(done []bool) string {
	bytes := make([]byte, (len(done)+7)/8)
	for i, b := range done {
		if b {
			bytes[i/8] |= 1 << (uint(i) % 8)
		}
	}
	return hex.EncodeToString(bytes)
}

func BoolsFromBitmap(hexStr string, total int) []bool {
	out := make([]bool, total)
	if hexStr == "" {
		return out
	}
	raw, err := hex.DecodeString(hexStr)
	if err != nil {
		return out
	}
	for i := 0; i < total && i/8 < len(raw); i++ {
		out[i] = raw[i/8]&(1<<(uint(i)%8)) != 0
	}
	return out
}
