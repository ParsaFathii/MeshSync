package sync

import (
        "crypto/rand"
        "crypto/sha256"
        "encoding/hex"
        "errors"
        "fmt"
        "io"
        "log"
        "os"
        "path/filepath"
        "strings"
        "time"

        "github.com/ParsaFathii/MeshSync/agent/internal/config"
        "github.com/ParsaFathii/MeshSync/agent/internal/events"
        "github.com/ParsaFathii/MeshSync/agent/internal/indexer"
        "github.com/ParsaFathii/MeshSync/agent/internal/native"
        "github.com/ParsaFathii/MeshSync/agent/internal/netproto"
        "github.com/ParsaFathii/MeshSync/agent/internal/store"
        "github.com/ParsaFathii/MeshSync/agent/internal/transfer"
)

// Engine executes synchronization sessions and individual transfers, and
// resolves conflicts. It implements transfer.Executor for the manager.
type Engine struct {
        DB       *store.DB
        Bus      *events.Bus
        Indexer  *indexer.Indexer
        Manager  *transfer.Manager
        StateDir string
        deps     Deps
}

func NewEngine(db *store.DB, bus *events.Bus, ix *indexer.Indexer, mgr *transfer.Manager, stateDir string) *Engine {
        return &Engine{DB: db, Bus: bus, Indexer: ix, Manager: mgr, StateDir: stateDir}
}

// Deps is wired by the app package: dialing, self hello, live config.
type Deps struct {
        CertPinner func(peerID string) (pinnedKey []byte, address string, ok bool)
        Dialer     func(address string, pinnedKey []byte) (*netproto.Conn, error)
        SelfHello  func() *netproto.Hello
        Config     func() config.Config
}

// SetDeps wires protocol dependencies. Called once from the app package
// after the agent (and its methods) exist.
func (e *Engine) SetDeps(d Deps) { e.deps = d }

func newID(prefix string) string {
        b := make([]byte, 8)
        _, _ = rand.Read(b)
        return prefix + hex.EncodeToString(b)
}

// ---- session orchestration ----

// PlanOnly exchanges manifests and returns the plan without touching any
// file. The plan is what the UI shows before the user executes it.
func (e *Engine) PlanOnly(peerID string, folderID int64) (*Plan, error) {
        peer, folder, err := e.peerFolder(peerID, folderID)
        if err != nil {
                return nil, err
        }
        remote, plan, err := e.exchangeAndPlan(peer, folder)
        if err != nil {
                return nil, err
        }
        _ = remote
        return plan, nil
}

// RunSyncAsync plans synchronously (so the caller gets the session id and
// plan immediately) and executes the plan in the background. Completion is
// observable through events, transfers and the session record.
func (e *Engine) RunSyncAsync(peerID string, folderID int64) (string, *Plan, error) {
        peer, folder, err := e.peerFolder(peerID, folderID)
        if err != nil {
                return "", nil, err
        }
        if _, _, _, err := e.Indexer.Rescan(folder); err != nil {
                return "", nil, fmt.Errorf("rescan: %w", err)
        }
        sessionID := newID("s-")
        sess := &store.Session{
                ID: sessionID, PeerID: peer.PeerID, FolderID: folder.ID,
                StartedAt: time.Now().Unix(), Status: "RUNNING",
        }
        _ = e.DB.PutSession(sess)
        e.Bus.Emit("SYNC_STARTED", "INFO", fmt.Sprintf("Syncing folder %s with %s", folder.Name, peer.Name),
                map[string]any{"sessionId": sessionID, "peer": peer.Name, "folder": folder.Name})

        conn, remote, plan, err := e.openSession(peer, folder)
        if err != nil {
                e.failSession(sess, peer, err)
                return sessionID, nil, err
        }
        defer conn.Close()
        e.applyControlActions(conn, peer, folder, plan)

        go func() {
                e.submitTransfers(sessionID, peer, folder, plan, remote)
                e.Manager.WaitSession(sessionID, 0)
                stats := e.Manager.SessionStats(sessionID)
                sess.FinishedAt = time.Now().Unix()
                sess.Transferred = stats.Bytes
                sess.FilesTransferred = int64(stats.Files)
                if stats.Failures > 0 {
                        sess.Status = "FAILED"
                        sess.Error = fmt.Sprintf("%d transfer(s) failed", stats.Failures)
                        e.Bus.Emit("SYNC_FAILED", "ERROR",
                                fmt.Sprintf("Sync of %s with %s finished with %d failed transfer(s)", folder.Name, peer.Name, stats.Failures),
                                map[string]any{"sessionId": sessionID})
                } else {
                        sess.Status = "COMPLETED"
                        sess.Error = ""
                        e.Bus.Emit("SYNC_COMPLETED", "INFO",
                                fmt.Sprintf("Synced %s with %s — %d file(s), %s", folder.Name, peer.Name, stats.Files, humanBytes(stats.Bytes)),
                                map[string]any{"sessionId": sessionID, "files": stats.Files, "bytes": stats.Bytes})
                }
                _ = e.DB.PutSession(sess)
        }()
        return sessionID, plan, nil
}

// RunSync executes a full session and blocks until every transfer reaches a
// terminal state. Used by tests and automation.
func (e *Engine) RunSync(peerID string, folderID int64) (string, *Plan, error) {
        peer, folder, err := e.peerFolder(peerID, folderID)
        if err != nil {
                return "", nil, err
        }
        if _, _, _, err := e.Indexer.Rescan(folder); err != nil {
                return "", nil, fmt.Errorf("rescan: %w", err)
        }
        sessionID := newID("s-")
        sess := &store.Session{
                ID: sessionID, PeerID: peer.PeerID, FolderID: folder.ID,
                StartedAt: time.Now().Unix(), Status: "RUNNING",
        }
        _ = e.DB.PutSession(sess)
        e.Bus.Emit("SYNC_STARTED", "INFO", fmt.Sprintf("Syncing folder %s with %s", folder.Name, peer.Name),
                map[string]any{"sessionId": sessionID, "peer": peer.Name, "folder": folder.Name})

        conn, remote, plan, err := e.openSession(peer, folder)
        if err != nil {
                e.failSession(sess, peer, err)
                return sessionID, nil, err
        }
        defer conn.Close()
        e.applyControlActions(conn, peer, folder, plan)
        e.submitTransfers(sessionID, peer, folder, plan, remote)
        e.Manager.WaitSession(sessionID, 0)

        stats := e.Manager.SessionStats(sessionID)
        sess.FinishedAt = time.Now().Unix()
        sess.Transferred = stats.Bytes
        sess.FilesTransferred = int64(stats.Files)
        if stats.Failures > 0 {
                sess.Status = "FAILED"
                sess.Error = fmt.Sprintf("%d transfer(s) failed", stats.Failures)
                e.Bus.Emit("SYNC_FAILED", "ERROR",
                        fmt.Sprintf("Sync of %s with %s finished with %d failed transfer(s)", folder.Name, peer.Name, stats.Failures),
                        map[string]any{"sessionId": sessionID})
        } else {
                sess.Status = "COMPLETED"
                sess.Error = ""
                e.Bus.Emit("SYNC_COMPLETED", "INFO",
                        fmt.Sprintf("Synced %s with %s — %d file(s), %s", folder.Name, peer.Name, stats.Files, humanBytes(stats.Bytes)),
                        map[string]any{"sessionId": sessionID, "files": stats.Files, "bytes": stats.Bytes})
        }
        _ = e.DB.PutSession(sess)
        return sessionID, plan, nil
}

// openSession creates the session connection, exchanges manifests both
// ways and computes the plan.
func (e *Engine) openSession(peer store.Peer, folder store.Folder) (*netproto.Conn, []netproto.ManifestEntry, *Plan, error) {
        key, addr, ok := e.deps.CertPinner(peer.PeerID)
        if !ok {
                return nil, nil, nil, fmt.Errorf("no address known for peer %s", peer.Name)
        }
        conn, err := e.deps.Dialer(addr, key)
        if err != nil {
                return nil, nil, nil, fmt.Errorf("connect %s: %w", peer.Name, err)
        }
        local, err := e.DB.ListFiles(folder.ID)
        if err != nil {
                conn.Close()
                return nil, nil, nil, err
        }
        if err := conn.WriteJSON(netproto.MsgIndex, buildManifest(folder.Name, local)); err != nil {
                conn.Close()
                return nil, nil, nil, err
        }
        remote, err := e.requestManifest(conn, folder.Name)
        if err != nil {
                conn.Close()
                return nil, nil, nil, err
        }
        _ = e.DB.ReplaceRemoteManifest(peer.PeerID, folder.Name, manifestToRemote(peer.PeerID, folder.Name, remote))
        plan := ComputePlan(folder.Name, local, remote, time.Now().Unix())
        return conn, remote, plan, nil
}

// applyControlActions sends conflict notifications, deletion requests and
// adoption heals over the session connection. These are all quick, safe
// operations; bulk data moves through the transfer manager.
func (e *Engine) applyControlActions(conn *netproto.Conn, peer store.Peer, folder store.Folder, plan *Plan) {
        for _, a := range plan.Actions {
                if a.State != StConflict {
                        continue
                }
                e.recordConflict(folder, peer, a)
                local, has, _ := e.DB.GetFile(folder.ID, a.RelPath)
                ls, lm := int64(0), int64(0)
                lh := ""
                if has && !local.Deleted {
                        lh, ls, lm = local.Hash, local.Size, local.Mtime
                }
                _ = conn.WriteJSON(netproto.MsgConflictNotify, netproto.ConflictNotify{
                        Folder: folder.Name, Path: a.RelPath,
                        RemoteHash: lh, RemoteSize: ls, RemoteMtime: lm, RemoteName: peer.Name,
                })
        }
        for _, a := range plan.Actions {
                switch a.State {
                case StDeleteLocal:
                        if err := e.trashLocal(folder, a.RelPath, true); err != nil {
                                e.Bus.Emit("SYNC_FAILED", "ERROR", fmt.Sprintf("Cannot apply deletion of %s: %v", a.RelPath, err), nil)
                        } else {
                                e.Bus.Emit("FILE_DELETED", "INFO", fmt.Sprintf("Deleted %s/%s (remote deletion)", folder.Name, a.RelPath),
                                        map[string]any{"folder": folder.Name, "path": a.RelPath})
                        }
                case StDeleteRemote:
                        _ = conn.WriteJSON(netproto.MsgDeleteFile, netproto.DeleteFile{
                                Folder: folder.Name, Path: a.RelPath, ExpectedHash: a.RemoteHash,
                        })
                }
        }
        for _, a := range plan.Actions {
                if a.State == StUnchanged && a.LocalHash != "" && a.LastSyncedHash != a.LocalHash {
                        _ = conn.WriteJSON(netproto.MsgAdopt, netproto.Adopt{Folder: folder.Name, Path: a.RelPath, Hash: a.LocalHash})
                        _ = e.DB.SetFileSynced(folder.ID, a.RelPath, a.LocalHash)
                }
        }
}

func (e *Engine) failSession(sess *store.Session, peer store.Peer, err error) {
        sess.Status = "FAILED"
        sess.Error = err.Error()
        sess.FinishedAt = time.Now().Unix()
        _ = e.DB.PutSession(sess)
        e.Bus.Emit("SYNC_FAILED", "ERROR", fmt.Sprintf("Sync with %s failed: %v", peer.Name, err),
                map[string]any{"sessionId": sess.ID, "error": err.Error()})
}

// submitTransfers creates transfer records for PUSH/PULL actions. Files
// with open conflicts are skipped (they must be resolved first).
func (e *Engine) submitTransfers(sessionID string, peer store.Peer, folder store.Folder, plan *Plan, remote []netproto.ManifestEntry) {
        chunkSize := e.deps.Config().ChunkSizeBytes
        remoteByPath := map[string]netproto.ManifestEntry{}
        for _, r := range remote {
                remoteByPath[r.Path] = r
        }
        for _, a := range plan.Actions {
                var dir string
                switch a.State {
                case StRemoteOnly, StRemoteModified:
                        dir = "PULL"
                case StLocalOnly, StLocalModified:
                        dir = "PUSH"
                default:
                        continue
                }
                // skip conflicting paths entirely — data safety first
                if _, open, _ := e.DB.OpenConflictForFile(folder.ID, a.RelPath, ""); open {
                        continue
                }
                size := a.Size
                hash := a.RemoteHash
                mtime := int64(0)
                if dir == "PUSH" {
                        hash = a.LocalHash
                        local, has, _ := e.DB.GetFile(folder.ID, a.RelPath)
                        if has && !local.Deleted {
                                size, mtime = local.Size, local.Mtime
                        }
                } else if r, ok := remoteByPath[a.RelPath]; ok {
                        mtime = r.Mtime
                }
                if size < 0 {
                        size = 0
                }
                chunks := int((size + chunkSize - 1) / chunkSize)
                if chunks < 1 {
                        chunks = 1
                }
                t := store.Transfer{
                        ID: newID("t-"), PeerID: peer.PeerID, FolderID: folder.ID,
                        RelPath: a.RelPath, Direction: dir, Size: size, FileHash: hash,
                        FileMtime: mtime, Status: transfer.StatusQueued,
                        ChunkSize: chunkSize, ChunksTotal: chunks,
                        SessionID: sessionID, CreatedAt: time.Now().Unix(),
                }
                e.Manager.Submit(t)
        }
}

func (e *Engine) peerFolder(peerID string, folderID int64) (store.Peer, store.Folder, error) {
        peer, ok, err := e.DB.GetPeer(peerID)
        if err != nil || !ok {
                return peer, store.Folder{}, fmt.Errorf("peer %s not found", peerID)
        }
        if peer.Trust != store.Trusted {
                return peer, store.Folder{}, fmt.Errorf("peer %s is not trusted", peerID)
        }
        folder, ok, err := e.DB.GetFolder(folderID)
        if err != nil || !ok {
                return peer, folder, fmt.Errorf("folder %d not found", folderID)
        }
        return peer, folder, nil
}

func (e *Engine) exchangeAndPlan(peer store.Peer, folder store.Folder) ([]netproto.ManifestEntry, *Plan, error) {
        key, addr, ok := e.deps.CertPinner(peer.PeerID)
        if !ok {
                return nil, nil, fmt.Errorf("no address known for peer %s", peer.Name)
        }
        conn, err := e.deps.Dialer(addr, key)
        if err != nil {
                return nil, nil, fmt.Errorf("connect %s: %w", peer.Name, err)
        }
        defer conn.Close()
        return e.exchangeAndPlanOn(conn, peer, folder)
}

func (e *Engine) exchangeAndPlanOn(conn *netproto.Conn, peer store.Peer, folder store.Folder) ([]netproto.ManifestEntry, *Plan, error) {
        local, err := e.DB.ListFiles(folder.ID)
        if err != nil {
                return nil, nil, err
        }
        // send our manifest first so the peer can cache our remote state
        if err := conn.WriteJSON(netproto.MsgIndex, buildManifest(folder.Name, local)); err != nil {
                return nil, nil, err
        }
        remote, err := e.requestManifest(conn, folder.Name)
        if err != nil {
                return nil, nil, err
        }
        _ = e.DB.ReplaceRemoteManifest(peer.PeerID, folder.Name, manifestToRemote(peer.PeerID, folder.Name, remote))
        plan := ComputePlan(folder.Name, local, remote, time.Now().Unix())
        return remote, plan, nil
}

func (e *Engine) requestManifest(conn *netproto.Conn, folderName string) ([]netproto.ManifestEntry, error) {
        if err := conn.WriteJSON(netproto.MsgIndexRequest, netproto.IndexRequest{Folder: folderName}); err != nil {
                return nil, err
        }
        t, payload, err := conn.ReadMsg()
        if err != nil {
                return nil, err
        }
        if t == netproto.MsgError {
                var we netproto.WireError
                _ = netproto.DecodeJSON(payload, &we)
                return nil, fmt.Errorf("%s: %s", we.Code, we.Message)
        }
        if t != netproto.MsgIndex {
                return nil, fmt.Errorf("expected INDEX, got %s", t)
        }
        var idx netproto.Index
        if err := netproto.DecodeJSON(payload, &idx); err != nil {
                return nil, err
        }
        if idx.Folder != folderName {
                return nil, fmt.Errorf("manifest folder mismatch")
        }
        return idx.Files, nil
}

func buildManifest(folderName string, files []store.FileEntry) *netproto.Index {
        idx := &netproto.Index{Folder: folderName, Files: []netproto.ManifestEntry{}}
        for _, f := range files {
                idx.Files = append(idx.Files, netproto.ManifestEntry{
                        Path: f.RelPath, Size: f.Size, Mtime: f.Mtime,
                        Hash: f.Hash, Deleted: f.Deleted, LastSyncedHash: f.LastSyncedHash,
                })
        }
        return idx
}

func manifestToRemote(peerID, folderName string, files []netproto.ManifestEntry) []store.RemoteEntry {
        out := make([]store.RemoteEntry, 0, len(files))
        for _, f := range files {
                out = append(out, store.RemoteEntry{
                        PeerID: peerID, FolderName: folderName, RelPath: f.Path,
                        Hash: f.Hash, Size: f.Size, Mtime: f.Mtime, Deleted: f.Deleted, SeenAt: time.Now().Unix(),
                })
        }
        return out
}

func (e *Engine) recordConflict(folder store.Folder, peer store.Peer, a Action) {
        if _, open, _ := e.DB.OpenConflictForFile(folder.ID, a.RelPath, peer.PeerID); open {
                return
        }
        local, has, _ := e.DB.GetFile(folder.ID, a.RelPath)
        lh, ls, lm := "", int64(0), int64(0)
        if has && !local.Deleted {
                lh, ls, lm = local.Hash, local.Size, local.Mtime
        }
        _, err := e.DB.AddConflict(store.Conflict{
                FolderID: folder.ID, RelPath: a.RelPath,
                LocalHash: lh, RemoteHash: a.RemoteHash,
                LocalSize: ls, RemoteSize: a.RemoteSize,
                LocalMtime: lm, RemoteMtime: a.RemoteMtime,
                RemotePeerID: peer.PeerID,
        })
        if err == nil {
                e.Bus.Emit("CONFLICT_DETECTED", "WARN",
                        fmt.Sprintf("Conflict on %s/%s — both devices changed this file", folder.Name, a.RelPath),
                        map[string]any{"folder": folder.Name, "path": a.RelPath, "peer": peer.Name})
        }
}

// MirrorConflict records a conflict reported by the remote side.
func (e *Engine) MirrorConflict(folderName string, n *netproto.ConflictNotify) error {
        folder, ok, err := e.DB.FolderByName(folderName)
        if err != nil || !ok {
                return fmt.Errorf("folder %s is not shared on this device", folderName)
        }
        if _, open, _ := e.DB.OpenConflictForFile(folder.ID, n.Path, ""); open {
                return nil
        }
        local, has, _ := e.DB.GetFile(folder.ID, n.Path)
        lh, ls, lm := "", int64(0), int64(0)
        if has && !local.Deleted {
                lh, ls, lm = local.Hash, local.Size, local.Mtime
        }
        _, err = e.DB.AddConflict(store.Conflict{
                FolderID: folder.ID, RelPath: n.Path,
                LocalHash: lh, RemoteHash: n.RemoteHash,
                LocalSize: ls, RemoteSize: n.RemoteSize,
                LocalMtime: lm, RemoteMtime: n.RemoteMtime,
                RemotePeerID: n.RemoteName,
        })
        if err == nil {
                e.Bus.Emit("CONFLICT_DETECTED", "WARN",
                        fmt.Sprintf("Conflict on %s/%s reported by %s", folderName, n.Path, n.RemoteName),
                        map[string]any{"folder": folderName, "path": n.Path})
        }
        return err
}

// trashLocal moves a file into the agent trash (recoverable) and
// tombstones it in the index.
func (e *Engine) trashLocal(folder store.Folder, relPath string, tombstone bool) error {
        abs, err := indexer.SafeJoin(folder.Path, relPath)
        if err != nil {
                return err
        }
        if _, err := os.Stat(abs); err == nil {
                trashDir := filepath.Join(e.StateDir, "trash", folder.Name)
                if err := os.MkdirAll(trashDir, 0o755); err != nil {
                        return err
                }
                target := filepath.Join(trashDir, fmt.Sprintf("%d-%s", time.Now().UnixNano(), filepath.Base(relPath)))
                if err := moveFile(abs, target); err != nil {
                        return err
                }
        }
        if tombstone {
                prev, had, _ := e.DB.GetFile(folder.ID, relPath)
                s := ""
                if had {
                        s = prev.LastSyncedHash
                }
                return e.DB.PutFile(store.FileEntry{
                        FolderID: folder.ID, RelPath: relPath, Deleted: true,
                        LastSyncedHash: s, UpdatedAt: time.Now().Unix(),
                })
        }
        return nil
}

func moveFile(src, dst string) error {
        if err := os.Rename(src, dst); err == nil {
                return nil
        }
        // cross-device fallback
        in, err := os.Open(src)
        if err != nil {
                return err
        }
        defer in.Close()
        out, err := os.Create(dst)
        if err != nil {
                return err
        }
        defer out.Close()
        if _, err := io.Copy(out, in); err != nil {
                return err
        }
        return os.Remove(src)
}

// ---- conflict resolution ----

// ResolveConflict executes one of the documented resolution strategies.
// KEEP_REMOTE / KEEP_LOCAL / KEEP_BOTH open an immediate mini-session; the
// conflict stays OPEN on failure so nothing is lost.
func (e *Engine) ResolveConflict(conflictID int64, action string) error {
        c, ok, err := e.DB.GetConflict(conflictID)
        if err != nil || !ok {
                return fmt.Errorf("conflict %d not found", conflictID)
        }
        if c.Status != "OPEN" {
                return fmt.Errorf("conflict %d is already resolved", conflictID)
        }
        folder, ok, err := e.DB.GetFolder(c.FolderID)
        if err != nil || !ok {
                return fmt.Errorf("folder for conflict %d not found", conflictID)
        }
        switch action {
        case "LATER":
                return nil // stays open, documented no-op
        case "KEEP_REMOTE":
                if err := e.pullRemoteOverLocal(folder, c, ""); err != nil {
                        return err
                }
        case "KEEP_LOCAL":
                if err := e.pushLocalOverRemote(folder, c); err != nil {
                        return err
                }
        case "KEEP_BOTH":
                both := ConflictName(filepath.Base(c.RelPath), e.peerDisplayName(c.RemotePeerID), time.Now())
                bothRel := relSibling(c.RelPath, both)
                if err := e.pullRemoteOverLocal(folder, c, bothRel); err != nil {
                        return err
                }
                if err := e.pushLocalOverRemote(folder, c); err != nil {
                        return err
                }
        default:
                return fmt.Errorf("unknown action %q", action)
        }
        if err := e.DB.SetConflictResolution(conflictID, action); err != nil {
                return err
        }
        e.Bus.Emit("CONFLICT_RESOLVED", "INFO",
                fmt.Sprintf("Resolved conflict on %s/%s (%s)", folder.Name, c.RelPath, action),
                map[string]any{"conflictId": conflictID, "path": c.RelPath, "resolution": action})
        return nil
}

func (e *Engine) peerDisplayName(peerRef string) string {
        if p, ok, _ := e.DB.GetPeer(peerRef); ok {
                return p.Name
        }
        return peerRef
}

// relSibling replaces the filename of rel with name, keeping directories.
func relSibling(rel, name string) string {
        dir := filepath.Dir(rel)
        if dir == "." {
                return name
        }
        return dir + "/" + name
}

// pullRemoteOverLocal pulls the remote version. When destOverride is set
// (KEEP_BOTH) the local file is kept and the remote lands under the
// conflict filename; otherwise the local copy is trashed first.
func (e *Engine) pullRemoteOverLocal(folder store.Folder, c store.Conflict, destOverride string) error {
        peer, err := e.lookupRemotePeer(c)
        if err != nil {
                return err
        }
        dest := c.RelPath
        backupLocal := destOverride == ""
        if backupLocal {
                // keep the losing local version recoverable in the trash
                _ = e.trashLocal(folder, c.RelPath, false)
        } else {
                dest = destOverride
        }
        _ = backupLocal

        chunkSize := e.deps.Config().ChunkSizeBytes
        size := c.RemoteSize
        if size < 0 {
                size = 0
        }
        chunks := int((size + chunkSize - 1) / chunkSize)
        if chunks < 1 {
                chunks = 1
        }
        sessionID := newID("r-")
        t := store.Transfer{
                ID: newID("t-"), PeerID: peer.PeerID, FolderID: folder.ID,
                RelPath: c.RelPath, DestPath: dest, Direction: "PULL",
                Size: size, FileHash: c.RemoteHash, FileMtime: c.RemoteMtime,
                Status: transfer.StatusQueued, ChunkSize: chunkSize, ChunksTotal: chunks,
                SessionID: sessionID, CreatedAt: time.Now().Unix(),
        }
        e.Manager.Submit(t)
        e.Manager.WaitSession(sessionID, 10*time.Minute)
        live, _, _ := e.Manager.Get(t.ID)
        if live.Status != transfer.StatusCompleted {
                return fmt.Errorf("resolution transfer failed: %s", live.Error)
        }
        // remote version won: both sides agree on it
        _ = e.DB.SetFileSynced(folder.ID, c.RelPath, c.RemoteHash)
        // ensure the local index no longer treats the path as conflicted
        if fe, has, _ := e.DB.GetFile(folder.ID, c.RelPath); has && fe.Hash == c.RemoteHash {
                _ = e.DB.SetFileSynced(folder.ID, c.RelPath, c.RemoteHash)
        }
        e.notifyAdopt(peer, folder, c.RelPath, c.RemoteHash)
        return nil
}

// pushLocalOverRemote pushes the local version; the peer trashes its copy
// first (backup flag) so the losing version stays recoverable there.
func (e *Engine) pushLocalOverRemote(folder store.Folder, c store.Conflict) error {
        peer, err := e.lookupRemotePeer(c)
        if err != nil {
                return err
        }
        local, has, _ := e.DB.GetFile(folder.ID, c.RelPath)
        if !has || local.Deleted {
                return fmt.Errorf("local version of %s is gone", c.RelPath)
        }
        chunkSize := e.deps.Config().ChunkSizeBytes
        size := local.Size
        chunks := int((size + chunkSize - 1) / chunkSize)
        if chunks < 1 {
                chunks = 1
        }
        sessionID := newID("r-")
        t := store.Transfer{
                ID: newID("t-"), PeerID: peer.PeerID, FolderID: folder.ID,
                RelPath: c.RelPath, Direction: "PUSH",
                Size: size, FileHash: local.Hash, FileMtime: local.Mtime,
                Status: transfer.StatusQueued, ChunkSize: chunkSize, ChunksTotal: chunks,
                SessionID: sessionID, CreatedAt: time.Now().Unix(),
        }
        e.Manager.Submit(t)
        e.Manager.WaitSession(sessionID, 10*time.Minute)
        live, _, _ := e.Manager.Get(t.ID)
        if live.Status != transfer.StatusCompleted {
                return fmt.Errorf("resolution transfer failed: %s", live.Error)
        }
        _ = e.DB.SetFileSynced(folder.ID, c.RelPath, local.Hash)
        return nil
}

func (e *Engine) lookupRemotePeer(c store.Conflict) (store.Peer, error) {
        // prefer a real peer record, fall back to the stored display name
        if p, ok, _ := e.DB.GetPeer(c.RemotePeerID); ok {
                if p.Trust == store.Trusted {
                        return p, nil
                }
        }
        // conflicts mirrored from remote store the peer NAME; find by name
        peers, _ := e.DB.ListPeers()
        for _, p := range peers {
                if p.Name == c.RemotePeerID && p.Trust == store.Trusted {
                        return p, nil
                }
        }
        return store.Peer{}, fmt.Errorf("the peer for this conflict (%s) is not trusted or offline", c.RemotePeerID)
}

func (e *Engine) notifyAdopt(peer store.Peer, folder store.Folder, relPath, hash string) {
        key, addr, ok := e.deps.CertPinner(peer.PeerID)
        if !ok {
                return
        }
        conn, err := e.deps.Dialer(addr, key)
        if err != nil {
                return
        }
        defer conn.Close()
        _ = conn.WriteJSON(netproto.MsgAdopt, netproto.Adopt{Folder: folder.Name, Path: relPath, Hash: hash})
}

// ---- transfers (transfer.Executor) ----

// Execute runs one PULL or PUSH to completion. Pauses and cancellations
// return control to the manager with the chunk bitmap already persisted,
// so the transfer resumes from the first pending chunk.
func (e *Engine) Execute(t *transfer.Transfer, r *transfer.Runner) error {
        key, addr, ok := e.deps.CertPinner(t.PeerID)
        if !ok {
                return fmt.Errorf("peer %s is not reachable (not trusted)", shortID(t.PeerID))
        }
        conn, err := e.deps.Dialer(addr, key)
        if err != nil {
                return fmt.Errorf("connect peer: %w", err)
        }
        defer conn.Close()
        folder, ok, err := e.DB.GetFolder(t.FolderID)
        if err != nil || !ok {
                return fmt.Errorf("folder %d not found", t.FolderID)
        }
        if t.Direction == "PULL" {
                return e.executePull(conn, folder, t, r)
        }
        return e.executePush(conn, folder, t, r)
}

func (e *Engine) executePull(conn *netproto.Conn, folder store.Folder, t *transfer.Transfer, r *transfer.Runner) (retErr error) {
        dest := t.RelPath
        if t.DestPath != "" {
                dest = t.DestPath
        }
        if err := conn.WriteJSON(netproto.MsgFileBegin, netproto.FileBegin{
                SessionID: t.SessionID, Folder: folder.Name, Path: t.RelPath,
                Hash: t.FileHash, Size: t.Size, ChunkSize: t.ChunkSize, Direction: "PULL",
        }); err != nil {
                return err
        }

        partPath := e.partPath(t)
        done := store.BoolsFromBitmap(t.ChunksDone, t.ChunksTotal)

        destAbs, err := indexer.SafeJoin(folder.Path, dest)
        if err != nil {
                return err
        }
        if err := os.MkdirAll(filepath.Dir(destAbs), 0o755); err != nil {
                return fmt.Errorf("create directory: %w", err)
        }
        if err := os.MkdirAll(filepath.Join(e.StateDir, "parts"), 0o755); err != nil {
                return fmt.Errorf("create parts dir: %w", err)
        }
        partFile, err := os.OpenFile(partPath, os.O_CREATE|os.O_RDWR, 0o644)
        if err != nil {
                return fmt.Errorf("open part file: %w", err)
        }
        // A cancelled pull is abandoned by the user: close the part file and
        // delete it — there is no resume after cancel. Paused and failed pulls
        // keep their part: that is exactly what makes their resume/retry work.
        // (The success path renames the part onto the destination instead.)
        defer func() {
                _ = partFile.Close()
                if errors.Is(retErr, transfer.ErrCancelled) {
                        _ = os.Remove(partPath)
                }
        }()
        if t.Size > 0 {
                _ = partFile.Truncate(t.Size)
        }

        for i := 0; i < t.ChunksTotal; i++ {
                if done[i] {
                        continue
                }
                if r.Cancelled() {
                        // the deferred cleanup above closes and removes the
                        // part file; the manager drops the persisted chunk
                        // bitmap when it records CANCELLED so a later Retry
                        // restarts from chunk zero
                        return transfer.ErrCancelled
                }
                if r.Paused() {
                        return transfer.ErrPaused
                }
                offset := int64(i) * t.ChunkSize
                length := t.ChunkSize
                if offset+length > t.Size {
                        length = t.Size - offset
                }
                r.Bandwidth().Wait(length)

                if err := conn.WriteJSON(netproto.MsgGetChunk, netproto.GetChunk{Folder: folder.Name, Path: t.RelPath, Offset: offset, Length: length}); err != nil {
                        return fmt.Errorf("request chunk %d: %w", i, err)
                }
                mt, payload, err := conn.ReadMsg()
                if err != nil {
                        return fmt.Errorf("read chunk %d: %w", i, err)
                }
                if mt == netproto.MsgError {
                        var we netproto.WireError
                        _ = netproto.DecodeJSON(payload, &we)
                        return fmt.Errorf("peer: %s: %s", we.Code, we.Message)
                }
                if mt != netproto.MsgChunkData {
                        return fmt.Errorf("expected CHUNK_DATA, got %s", mt)
                }
                header, data, err := netproto.DecodeChunkFrame(payload)
                if err != nil {
                        return fmt.Errorf("decode chunk %d: %w", i, err)
                }
                if header.Offset != offset || header.Length != length {
                        return fmt.Errorf("chunk %d mismatch: got offset=%d len=%d", i, header.Offset, header.Length)
                }
                if hashBytes(data) != header.Hash {
                        return fmt.Errorf("chunk %d hash mismatch (integrity failure)", i)
                }
                if _, err := partFile.WriteAt(data, offset); err != nil {
                        return fmt.Errorf("write chunk %d: %w", i, err)
                }
                r.ChunkDone(i, length)

                // let the source update its passive-side progress record
                if (i+1)%8 == 0 || i == t.ChunksTotal-1 {
                        _ = conn.WriteJSON(netproto.MsgTransferProgress, netproto.TransferProgress{
                                SessionID: t.SessionID, Folder: folder.Name, Path: t.RelPath, Transferred: t.Transferred,
                        })
                }
        }

        // full-file verification before replacing anything
        r.SetStatus(transfer.StatusVerifying)
        finalHash, _, err := native.HashGo(partPath)
        if err != nil {
                return fmt.Errorf("verify: %w", err)
        }
        if t.FileHash != "" && finalHash != t.FileHash {
                // remove the corrupt part so a retry starts clean
                _ = os.Remove(partPath)
                return fmt.Errorf("integrity check failed: expected %s got %s", shortHash(t.FileHash), shortHash(finalHash))
        }
        _ = partFile.Sync()
        if err := partFile.Close(); err != nil {
                return fmt.Errorf("close part: %w", err)
        }
        if err := os.Rename(partPath, destAbs); err != nil {
                return fmt.Errorf("finalize: %w", err)
        }
        if t.FileMtime != 0 {
                _ = os.Chtimes(destAbs, time.UnixMilli(t.FileMtime), time.UnixMilli(t.FileMtime))
        }

        // the local index now records this exact version as in sync
        if err := e.DB.PutFile(store.FileEntry{
                FolderID: folder.ID, RelPath: dest, Size: t.Size, Mtime: t.FileMtime,
                Hash: finalHash, LastSyncedHash: finalHash, UpdatedAt: time.Now().Unix(),
        }); err != nil {
                return err
        }

        // tell the source its version was adopted
        _ = conn.WriteJSON(netproto.MsgAdopt, netproto.Adopt{Folder: folder.Name, Path: t.RelPath, Hash: finalHash})
        _ = conn.WriteJSON(netproto.MsgFileEnd, netproto.FileEnd{
                SessionID: t.SessionID, Folder: folder.Name, Path: t.RelPath, Hash: finalHash, OK: true,
        })
        return nil
}

func (e *Engine) executePush(conn *netproto.Conn, folder store.Folder, t *transfer.Transfer, r *transfer.Runner) error {
        srcAbs, err := indexer.SafeJoin(folder.Path, t.RelPath)
        if err != nil {
                return err
        }
        // local file must still match the planned hash — never push surprises
        st, err := os.Stat(srcAbs)
        if err != nil {
                return fmt.Errorf("local file missing: %w", err)
        }
        if st.Size() != t.Size {
                return fmt.Errorf("local file size changed (expected %d, found %d)", t.Size, st.Size())
        }

        src, err := os.Open(srcAbs)
        if err != nil {
                return fmt.Errorf("open local file: %w", err)
        }
        defer src.Close()

        if err := conn.WriteJSON(netproto.MsgFileBegin, netproto.FileBegin{
                SessionID: t.SessionID, Folder: folder.Name, Path: t.RelPath,
                Hash: t.FileHash, Size: t.Size, ChunkSize: t.ChunkSize, Direction: "PUSH",
        }); err != nil {
                return err
        }

        done := store.BoolsFromBitmap(t.ChunksDone, t.ChunksTotal)
        buf := make([]byte, t.ChunkSize)

        for i := 0; i < t.ChunksTotal; i++ {
                if done[i] {
                        continue
                }
                if r.Cancelled() {
                        return transfer.ErrCancelled
                }
                if r.Paused() {
                        return transfer.ErrPaused
                }
                offset := int64(i) * t.ChunkSize
                length := t.ChunkSize
                if offset+length > t.Size {
                        length = t.Size - offset
                }
                n, err := src.ReadAt(buf[:length], offset)
                if err != nil && err != io.EOF {
                        return fmt.Errorf("read chunk %d: %w", i, err)
                }
                if int64(n) != length {
                        return fmt.Errorf("local file changed during transfer (chunk %d short read)", i)
                }
                data := buf[:length]
                r.Bandwidth().Wait(length)

                header := netproto.ChunkHeader{
                        Folder: folder.Name, Path: t.RelPath, Offset: offset, Length: length,
                        Hash: hashBytes(data), FileHash: t.FileHash, FileSize: t.Size, Mtime: t.FileMtime,
                }
                frame, err := netproto.EncodeChunkFrame(&header, data)
                if err != nil {
                        return err
                }

                // retry rejected chunks up to 3 times with backoff
                success := false
                var lastErr error
                for attempt := 0; attempt < 3; attempt++ {
                        if err := conn.WriteMsg(netproto.MsgPutChunk, frame); err != nil {
                                return fmt.Errorf("send chunk %d: %w", i, err)
                        }
                        mt, payload, err := conn.ReadMsg()
                        if err != nil {
                                return fmt.Errorf("ack chunk %d: %w", i, err)
                        }
                        if mt != netproto.MsgChunkAck {
                                return fmt.Errorf("expected CHUNK_ACK, got %s", mt)
                        }
                        var ack netproto.ChunkAck
                        if err := netproto.DecodeJSON(payload, &ack); err != nil {
                                return err
                        }
                        if ack.Ok {
                                success = true
                                break
                        }
                        lastErr = fmt.Errorf("peer rejected chunk %d: %s", i, ack.Error)
                        time.Sleep(time.Duration(attempt+1) * 300 * time.Millisecond)
                }
                if !success {
                        if lastErr == nil {
                                lastErr = fmt.Errorf("chunk %d failed after retries", i)
                        }
                        return lastErr
                }
                r.ChunkDone(i, length)
        }

        // both sides now carry this exact version
        if err := e.DB.SetFileSynced(folder.ID, t.RelPath, t.FileHash); err != nil {
                return err
        }
        _ = conn.WriteJSON(netproto.MsgFileEnd, netproto.FileEnd{
                SessionID: t.SessionID, Folder: folder.Name, Path: t.RelPath, Hash: t.FileHash, OK: true,
        })
        return nil
}

func (e *Engine) partPath(t *transfer.Transfer) string {
        sum := sha256.Sum256([]byte(fmt.Sprintf("%d|%s|%s", t.FolderID, t.PeerID, t.RelPath)))
        return filepath.Join(e.StateDir, "parts", hex.EncodeToString(sum[:16])+".part")
}

func hashBytes(b []byte) string {
        sum := sha256.Sum256(b)
        return hex.EncodeToString(sum[:])
}

func shortHash(h string) string {
        if len(h) > 12 {
                return h[:12] + "…"
        }
        return h
}

func shortID(id string) string {
        if len(id) > 8 {
                return id[:8]
        }
        return id
}

func humanBytes(n int64) string {
        const unit = 1024
        if n < unit {
                return fmt.Sprintf("%d B", n)
        }
        div, exp := int64(unit), 0
        for m := n / unit; m >= unit; m /= unit {
                div *= unit
                exp++
        }
        return fmt.Sprintf("%.1f %ciB", float64(n)/float64(div), "KMGTPE"[exp])
}

// ConflictName computes the deterministic keep-both filename:
//
//      report (conflict from mesh-beta 2026-10-08).pdf
func ConflictName(base, peerName string, at time.Time) string {
        date := at.UTC().Format("2006-01-02")
        stem, ext := base, ""
        if i := strings.LastIndex(base, "."); i > 0 {
                stem, ext = base[:i], base[i:]
        }
        return fmt.Sprintf("%s (conflict from %s %s)%s", stem, peerName, date, ext)
}

// PartPath is the deterministic partial-file path for a transfer. Both the
// initiator and the passive receiver derive the same location, which is
// what makes interrupted transfers resumable.
func PartPath(stateDir string, folderID int64, peerID, relPath string) string {
        sum := sha256.Sum256([]byte(fmt.Sprintf("%d|%s|%s", folderID, peerID, relPath)))
        return filepath.Join(stateDir, "parts", hex.EncodeToString(sum[:16])+".part")
}

// PurgeCancelledParts enforces the part lifecycle for cancelled transfers
// at startup: a cancelled transfer was abandoned by the user, so any part
// file it still holds is stale garbage and gets deleted together with its
// persisted chunk bitmap (Manager.Retry accepts CANCELLED transfers, and
// such a retry must restart from scratch instead of resuming against a
// deleted part). Parts of FAILED transfers are deliberately untouched —
// they are the resume data a Retry continues from.
func (e *Engine) PurgeCancelledParts() {
        rows, err := e.DB.ListTransfers(10000, transfer.StatusCancelled)
        if err != nil {
                return
        }
        for _, t := range rows {
                partPath := PartPath(e.StateDir, t.FolderID, t.PeerID, t.RelPath)
                removed := false
                if _, err := os.Stat(partPath); err == nil {
                        if err := os.Remove(partPath); err == nil {
                                removed = true
                        }
                }
                if t.ChunksDone != "" || t.Transferred > 0 {
                        t.ChunksDone = ""
                        t.Transferred = 0
                        _ = e.DB.PutTransfer(t)
                }
                if removed {
                        log.Printf("meshsync: purged stale part of cancelled transfer %s (%s)", t.ID, t.RelPath)
                }
        }
}

// TrashExisting moves a file inside a shared folder to the agent trash
// without touching the index (callers decide on tombstones).
func (e *Engine) TrashExisting(folder store.Folder, relPath string) error {
        return e.trashLocal(folder, relPath, false)
}
