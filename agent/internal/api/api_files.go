package api

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/ParsaFathii/MeshSync/agent/internal/indexer"
	"github.com/ParsaFathii/MeshSync/agent/internal/store"
	"github.com/ParsaFathii/MeshSync/agent/internal/transfer"
)

// ---- files ----

func (s *Server) parseFolderParam(r *http.Request) (store.Folder, bool) {
	folderID, err := parseID(r.URL.Query().Get("folder"))
	if err != nil {
		return store.Folder{}, false
	}
	folder, ok, err := s.A.DB.GetFolder(folderID)
	if err != nil || !ok {
		return store.Folder{}, false
	}
	return folder, true
}

func parseID(v string) (int64, error) {
	return strconvParseInt(v)
}

func strconvParseInt(v string) (int64, error) {
	var n int64
	_, err := fmt.Sscanf(v, "%d", &n)
	return n, err
}

// syncStateFor computes the per-file sync badge state.
func (s *Server) syncStateFor(folder store.Folder, rel string, entry store.FileEntry, hasEntry bool,
	conflicts []store.Conflict, live []transfer.Transfer) string {
	for _, c := range conflicts {
		if c.FolderID == folder.ID && c.RelPath == rel && c.Status == "OPEN" {
			return "CONFLICT"
		}
	}
	for _, t := range live {
		if t.FolderID == folder.ID && t.RelPath == rel {
			switch t.Status {
			case transfer.StatusTransferring, transfer.StatusPreparing, transfer.StatusQueued, transfer.StatusVerifying, transfer.StatusPaused:
				return "SYNCING"
			}
		}
	}
	if !hasEntry {
		return "PENDING"
	}
	if entry.Deleted {
		return "PENDING"
	}
	if entry.Hash != "" && entry.LastSyncedHash == entry.Hash {
		return "SYNCED"
	}
	if entry.Hash != "" && entry.LastSyncedHash == "" {
		// never synced, but a remote peer already carries this hash?
		peers, _ := s.A.DB.ListPeers()
		for _, p := range peers {
			if p.Trust != store.Trusted {
				continue
			}
			remote, _ := s.A.DB.RemoteEntryFor(p.PeerID, folder.Name, rel)
			if remote != nil && remote.Hash == entry.Hash {
				return "SYNCED"
			}
		}
	}
	return "PENDING"
}

func (s *Server) remotePeersFor(folder store.Folder, rel, hash string) []string {
	out := []string{}
	peers, _ := s.A.DB.ListPeers()
	for _, p := range peers {
		if p.Trust != store.Trusted {
			continue
		}
		remote, _ := s.A.DB.RemoteEntryFor(p.PeerID, folder.Name, rel)
		if remote != nil && !remote.Deleted && remote.Hash == hash {
			out = append(out, p.PeerID)
		}
	}
	return out
}

func (s *Server) handleFiles(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.filesList(w, r)
	case http.MethodPost:
		s.fileCreate(w, r)
	case http.MethodDelete:
		s.fileDelete(w, r)
	default:
		writeErr(w, http.StatusMethodNotAllowed, "BAD_REQUEST", "GET, POST or DELETE")
	}
}

func (s *Server) filesList(w http.ResponseWriter, r *http.Request) {
	folder, ok := s.parseFolderParam(r)
	if !ok {
		writeErr(w, http.StatusNotFound, "FOLDER_NOT_FOUND", "folder not found")
		return
	}
	relDir := strings.Trim(r.URL.Query().Get("path"), "/")
	listing, err := s.A.Indexer.ListDir(folder, relDir)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "VALIDATION", err.Error())
		return
	}
	conflicts, _ := s.A.DB.ListConflicts(true)
	live := s.A.Manager.Live(0, "ALL")
	entries := []map[string]any{}
	for _, l := range listing {
		rel := l.Name
		if relDir != "" {
			rel = relDir + "/" + l.Name
		}
		if l.Dir {
			// directory summary from the index
			files, bytes := s.dirStats(folder, rel)
			entries = append(entries, map[string]any{
				"name": l.Name, "type": "dir", "fileCount": files, "totalBytes": bytes,
			})
			continue
		}
		entry, has, _ := s.A.DB.GetFile(folder.ID, rel)
		entries = append(entries, map[string]any{
			"name": l.Name, "type": "file", "size": l.Size,
			"mtime": msToRFC(l.Mtime), "hash": l.Hash,
			"syncState":   s.syncStateFor(folder, rel, entry, has, conflicts, live),
			"remotePeers": s.remotePeersFor(folder, rel, l.Hash),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"folder": map[string]any{"id": folder.ID, "name": folder.Name},
		"path":   relDir, "entries": entries,
	})
}

func (s *Server) dirStats(folder store.Folder, relDir string) (int, int64) {
	files, _ := s.A.DB.ListFiles(folder.ID)
	prefix := relDir + "/"
	n, b := 0, int64(0)
	for _, f := range files {
		if f.Deleted || !strings.HasPrefix(f.RelPath, prefix) || strings.Contains(strings.TrimPrefix(f.RelPath, prefix), "/") {
			continue
		}
		n++
		b += f.Size
	}
	return n, b
}

func msToRFC(ms int64) string {
	if ms <= 0 {
		return ""
	}
	return time.UnixMilli(ms).UTC().Format(time.RFC3339)
}

// fileCreate writes a real file (JSON body or multipart upload) and
// indexes it immediately.
func (s *Server) fileCreate(w http.ResponseWriter, r *http.Request) {
	folderID, err := parseID(r.FormValue("folder"))
	relPath := ""
	var content []byte
	ct := r.Header.Get("Content-Type")
	if strings.HasPrefix(ct, "multipart/form-data") {
		if err := r.ParseMultipartForm(64 << 20); err != nil {
			writeErr(w, http.StatusBadRequest, "VALIDATION", "invalid multipart form")
			return
		}
		folderID, err = parseID(r.FormValue("folder"))
		relPath = strings.Trim(r.FormValue("path"), "/")
		f, _, ferr := r.FormFile("file")
		if ferr != nil {
			writeErr(w, http.StatusBadRequest, "VALIDATION", "file part is required")
			return
		}
		defer f.Close()
		content, err = io.ReadAll(f)
	} else {
		var body struct {
			Folder   int64  `json:"folder"`
			Path     string `json:"path"`
			Content  string `json:"content"`
			Encoding string `json:"encoding"`
		}
		if readJSON(r, &body) != nil || body.Path == "" {
			writeErr(w, http.StatusBadRequest, "VALIDATION", "folder and path are required")
			return
		}
		folderID, err = parseID(fmt.Sprint(body.Folder))
		relPath = strings.Trim(body.Path, "/")
		if body.Encoding == "base64" {
			content = []byte(body.Content)
		} else {
			content = []byte(body.Content)
		}
	}
	if err != nil {
		writeErr(w, http.StatusBadRequest, "VALIDATION", "invalid folder id")
		return
	}
	folder, ok, err := s.A.DB.GetFolder(folderID)
	if err != nil || !ok {
		writeErr(w, http.StatusBadRequest, "FOLDER_NOT_FOUND", "folder not found")
		return
	}
	abs, err := indexer.SafeJoin(folder.Path, relPath)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "VALIDATION", err.Error())
		return
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		writeErr(w, http.StatusInternalServerError, "IO_ERROR", err.Error())
		return
	}
	if err := os.WriteFile(abs, content, 0o644); err != nil {
		writeErr(w, http.StatusInternalServerError, "IO_ERROR", err.Error())
		return
	}
	entry, err := s.A.Indexer.IndexFile(folder, relPath)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "IO_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, s.fileDetailJSON(folder, relPath, entry))
}

func (s *Server) fileDelete(w http.ResponseWriter, r *http.Request) {
	folder, ok := s.parseFolderParam(r)
	if !ok {
		writeErr(w, http.StatusNotFound, "FOLDER_NOT_FOUND", "folder not found")
		return
	}
	rel := strings.Trim(r.URL.Query().Get("path"), "/")
	if rel == "" {
		writeErr(w, http.StatusBadRequest, "VALIDATION", "path is required")
		return
	}
	if err := s.A.Engine.TrashExisting(folder, rel); err != nil {
		writeErr(w, http.StatusBadRequest, "VALIDATION", err.Error())
		return
	}
	prev, had, _ := s.A.DB.GetFile(folder.ID, rel)
	lastSynced := ""
	if had {
		lastSynced = prev.LastSyncedHash
	}
	_ = s.A.DB.PutFile(store.FileEntry{
		FolderID: folder.ID, RelPath: rel, Deleted: true,
		LastSyncedHash: lastSynced, UpdatedAt: time.Now().Unix(),
	})
	s.A.Bus.Emit("FILE_DELETED", "INFO", fmt.Sprintf("Deleted %s/%s (moved to trash)", folder.Name, rel),
		map[string]any{"folder": folder.Name, "path": rel})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleFileContent(w http.ResponseWriter, r *http.Request) {
	folder, ok := s.parseFolderParam(r)
	if !ok {
		writeErr(w, http.StatusNotFound, "FOLDER_NOT_FOUND", "folder not found")
		return
	}
	rel := strings.Trim(r.URL.Query().Get("path"), "/")
	abs, err := indexer.SafeJoin(folder.Path, rel)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "VALIDATION", err.Error())
		return
	}
	f, err := os.Open(abs)
	if err != nil {
		writeErr(w, http.StatusNotFound, "NOT_FOUND", "file not found")
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() {
		writeErr(w, http.StatusNotFound, "NOT_FOUND", "not a regular file")
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filepath.Base(rel)))
	w.Header().Set("Content-Length", fmt.Sprint(st.Size()))
	_, _ = io.Copy(w, f)
}

func (s *Server) fileDetailJSON(folder store.Folder, rel string, entry store.FileEntry) map[string]any {
	conflicts, _ := s.A.DB.ListConflicts(true)
	live := s.A.Manager.Live(0, "ALL")
	chunkSize := s.A.LiveConfig().ChunkSizeBytes
	chunksTotal := int((entry.Size + chunkSize - 1) / chunkSize)
	if chunksTotal < 1 {
		chunksTotal = 1
	}
	chunks := []map[string]any{}
	chunkStates, _, hasLive := s.A.Manager.Chunks(s.transferIDFor(folder, rel, live))
	if !hasLive {
		chunkStates = nil
	}
	for i := 0; i < chunksTotal; i++ {
		st := "DONE"
		if entry.LastSyncedHash != entry.Hash {
			st = "DONE" // file exists on disk complete; sync state is separate
		}
		if chunkStates != nil && i < len(chunkStates) {
			if chunkStates[i] {
				st = "DONE"
			} else {
				st = "PENDING"
			}
		}
		size := chunkSize
		if int64(i)*chunkSize+size > entry.Size {
			size = entry.Size - int64(i)*chunkSize
		}
		if size < 0 {
			size = 0
		}
		chunks = append(chunks, map[string]any{"index": i, "size": size, "state": st})
	}
	peers := map[string]any{}
	allPeers, _ := s.A.DB.ListPeers()
	for _, p := range allPeers {
		if p.Trust != store.Trusted {
			continue
		}
		remote, _ := s.A.DB.RemoteEntryFor(p.PeerID, folder.Name, rel)
		if remote != nil {
			peers[p.PeerID] = map[string]any{
				"hash": remote.Hash, "size": remote.Size,
				"mtime": msToRFC(remote.Mtime), "seenAt": rfcOrEmpty(remote.SeenAt),
			}
		}
	}
	return map[string]any{
		"type": "file", "name": filepath.Base(rel),
		"folder": map[string]any{"id": folder.ID, "name": folder.Name},
		"path":   rel, "size": entry.Size, "mtime": msToRFC(entry.Mtime),
		"hash": entry.Hash, "syncState": s.syncStateFor(folder, rel, entry, true, conflicts, live),
		"lastSyncedHash": entry.LastSyncedHash,
		"chunkSize":      chunkSize, "chunks": chunks, "peers": peers,
	}
}

func (s *Server) transferIDFor(folder store.Folder, rel string, live []transfer.Transfer) string {
	for _, t := range live {
		if t.FolderID == folder.ID && t.RelPath == rel {
			return t.ID
		}
	}
	return ""
}

func (s *Server) handleFileDetail(w http.ResponseWriter, r *http.Request) {
	folder, ok := s.parseFolderParam(r)
	if !ok {
		writeErr(w, http.StatusNotFound, "FOLDER_NOT_FOUND", "folder not found")
		return
	}
	rel := strings.Trim(r.URL.Query().Get("path"), "/")
	entry, has, err := s.A.DB.GetFile(folder.ID, rel)
	if err != nil || !has {
		// maybe not indexed yet: index on demand
		entry, err = s.A.Indexer.IndexFile(folder, rel)
		if err != nil {
			writeErr(w, http.StatusNotFound, "NOT_FOUND", "file not found")
			return
		}
	}
	if entry.Deleted {
		writeErr(w, http.StatusNotFound, "NOT_FOUND", "file was deleted")
		return
	}
	writeJSON(w, http.StatusOK, s.fileDetailJSON(folder, rel, entry))
}

// ---- sync ----

func (s *Server) handleSyncPlan(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "BAD_REQUEST", "GET only")
		return
	}
	peerID := r.URL.Query().Get("peer")
	folderID, err := parseID(r.URL.Query().Get("folder"))
	if peerID == "" || err != nil {
		writeErr(w, http.StatusBadRequest, "VALIDATION", "peer and folder are required")
		return
	}
	peer, ok, _ := s.A.DB.GetPeer(peerID)
	if !ok {
		writeErr(w, http.StatusNotFound, "PEER_NOT_FOUND", "peer not found")
		return
	}
	folder, fok, _ := s.A.DB.GetFolder(folderID)
	if !fok {
		writeErr(w, http.StatusNotFound, "FOLDER_NOT_FOUND", "folder not found")
		return
	}
	plan, err := s.A.Engine.PlanOnly(peerID, folderID)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "PEER_OFFLINE", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"peer":        map[string]any{"peerId": peer.PeerID, "name": peer.Name},
		"folder":      map[string]any{"id": folder.ID, "name": folder.Name},
		"generatedAt": time.Unix(plan.GeneratedAt, 0).UTC().Format(time.RFC3339),
		"summary":     plan.Summary, "actions": actionsJSON(plan),
	})
}

func (s *Server) handleSyncRun(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "BAD_REQUEST", "POST only")
		return
	}
	var body struct {
		Peer   string `json:"peer"`
		Folder int64  `json:"folder"`
	}
	if readJSON(r, &body) != nil || body.Peer == "" {
		writeErr(w, http.StatusBadRequest, "VALIDATION", "peer and folder are required")
		return
	}
	peer, ok, _ := s.A.DB.GetPeer(body.Peer)
	if !ok {
		writeErr(w, http.StatusNotFound, "PEER_NOT_FOUND", "peer not found")
		return
	}
	if peer.Trust != store.Trusted {
		writeErr(w, http.StatusForbidden, "NOT_TRUSTED", "peer is not trusted")
		return
	}
	folder, fok, _ := s.A.DB.GetFolder(body.Folder)
	if !fok {
		writeErr(w, http.StatusNotFound, "FOLDER_NOT_FOUND", "folder not found")
		return
	}
	if !s.A.IsOnline(peer.PeerID) {
		writeErr(w, http.StatusBadGateway, "PEER_OFFLINE", peer.Name+" is unreachable")
		return
	}
	sessionID, plan, err := s.A.Engine.RunSyncAsync(body.Peer, body.Folder)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "PEER_OFFLINE", err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{
		"sessionId": sessionID,
		"plan": map[string]any{
			"peer":        map[string]any{"peerId": peer.PeerID, "name": peer.Name},
			"folder":      map[string]any{"id": folder.ID, "name": folder.Name},
			"generatedAt": time.Unix(plan.GeneratedAt, 0).UTC().Format(time.RFC3339),
			"summary":     plan.Summary,
			"actions":     actionsJSON(plan),
		},
	})
}

func (s *Server) handleSessions(w http.ResponseWriter, r *http.Request) {
	sessions, err := s.A.DB.ListSessions(25)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "IO_ERROR", err.Error())
		return
	}
	out := []map[string]any{}
	for _, sess := range sessions {
		peerName := sess.PeerID
		if p, ok, _ := s.A.DB.GetPeer(sess.PeerID); ok {
			peerName = p.Name
		}
		folderName := ""
		if f, ok, _ := s.A.DB.GetFolder(sess.FolderID); ok {
			folderName = f.Name
		}
		out = append(out, map[string]any{
			"id": sess.ID, "peerId": sess.PeerID, "peerName": peerName,
			"folderId": sess.FolderID, "folderName": folderName,
			"startedAt": rfcOrEmpty(sess.StartedAt), "finishedAt": rfcOrEmpty(sess.FinishedAt),
			"status": sess.Status, "transferred": sess.Transferred,
			"filesTransferred": sess.FilesTransferred, "error": nilIfEmpty(sess.Error),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": out})
}

func nilIfEmpty(v string) any {
	if v == "" {
		return nil
	}
	return v
}
