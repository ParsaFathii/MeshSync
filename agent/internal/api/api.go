// Package api serves the local agent HTTP API (v1) and the WebSocket event
// stream described in docs/API.md. The API binds to localhost by default
// and supports optional bearer-token authentication.
package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"github.com/ParsaFathii/MeshSync/agent/internal/app"
	"github.com/ParsaFathii/MeshSync/agent/internal/store"
	"github.com/ParsaFathii/MeshSync/agent/internal/transfer"
	"github.com/ParsaFathii/MeshSync/agent/internal/version"
)

type Server struct {
	A     *app.Agent
	mux   *http.ServeMux
	httpS *http.Server

	wsMu    sync.Mutex
	wsConns map[*wsClient]bool

	rlMu    sync.Mutex
	rlCount map[string]int
	rlWin   time.Time
}

type wsClient struct {
	conn *websocket.Conn
	send chan []byte
}

func New(a *app.Agent) *Server {
	s := &Server{A: a, mux: http.NewServeMux(), wsConns: map[*wsClient]bool{}, rlCount: map[string]int{}}
	s.routes()
	a.SetBroadcast(s.Broadcast)
	go s.eventPump()
	return s
}

// Listen starts the HTTP server on the configured bind address.
func (s *Server) Listen(addr string) error {
	s.httpS = &http.Server{
		Addr:              addr,
		Handler:           s.middleware(s.mux),
		ReadHeaderTimeout: 10 * time.Second,
	}
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	go func() { _ = s.httpS.Serve(ln) }()
	return nil
}

func (s *Server) Stop() {
	if s.httpS != nil {
		_ = s.httpS.Close()
	}
	s.wsMu.Lock()
	for c := range s.wsConns {
		close(c.send)
	}
	s.wsMu.Unlock()
}

// ---- middleware: CORS, optional auth, rate limiting ----

func (s *Server) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if !s.allowRate(r) {
			writeErr(w, http.StatusTooManyRequests, "RATE_LIMITED", "too many requests")
			return
		}
		if tok := s.A.LiveConfig().APIToken; tok != "" {
			got := r.Header.Get("Authorization")
			if got != "Bearer "+tok {
				writeErr(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing or invalid API token")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// allowRate: generous per-IP budget (600 requests / 10s) with hard 429s
// beyond it — enough for a dashboard, tight against runaway loops.
func (s *Server) allowRate(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	now := time.Now()
	s.rlMu.Lock()
	defer s.rlMu.Unlock()
	if now.Sub(s.rlWin) > 10*time.Second {
		s.rlWin = now
		s.rlCount = map[string]int{}
	}
	s.rlCount[host]++
	return s.rlCount[host] <= 600
}

// ---- helpers ----

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": msg}})
}

func readJSON(r *http.Request, v any) error {
	defer r.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, v)
}

func pathID(seg string) string { return seg }

// ---- routes ----

func (s *Server) routes() {
	m := s.mux
	m.HandleFunc("/api/v1/health", s.handleHealth)
	m.HandleFunc("/api/v1/device", s.handleDevice)
	m.HandleFunc("/api/v1/peers", s.handlePeers)
	m.HandleFunc("/api/v1/peers/pair", s.handlePair)
	m.HandleFunc("/api/v1/peers/", s.handlePeerActions)
	m.HandleFunc("/api/v1/discovery/scan", s.handleDiscoveryScan)
	m.HandleFunc("/api/v1/shared-folders", s.handleFolders)
	m.HandleFunc("/api/v1/shared-folders/", s.handleFolderActions)
	m.HandleFunc("/api/v1/files", s.handleFiles)
	m.HandleFunc("/api/v1/files/content", s.handleFileContent)
	m.HandleFunc("/api/v1/files/detail", s.handleFileDetail)
	m.HandleFunc("/api/v1/sync/plan", s.handleSyncPlan)
	m.HandleFunc("/api/v1/sync/run", s.handleSyncRun)
	m.HandleFunc("/api/v1/sync/sessions", s.handleSessions)
	m.HandleFunc("/api/v1/transfers", s.handleTransfers)
	m.HandleFunc("/api/v1/transfers/", s.handleTransferActions)
	m.HandleFunc("/api/v1/conflicts", s.handleConflicts)
	m.HandleFunc("/api/v1/conflicts/", s.handleConflictResolve)
	m.HandleFunc("/api/v1/events", s.handleEvents)
	m.HandleFunc("/api/v1/events/ws", s.handleWS)
	m.HandleFunc("/api/v1/settings", s.handleSettings)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "BAD_REQUEST", "GET only")
		return
	}
	dbOk := true
	if _, err := s.A.DB.ListPeers(); err != nil {
		dbOk = false
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok", "version": version.Version,
		"uptimeSeconds": uptime(), "dbOk": dbOk,
	})
}

var startAt = time.Now()

func uptime() int64 { return int64(time.Since(startAt).Seconds()) }

// ---- device ----

func (s *Server) deviceSnapshot() map[string]any {
	cfg := s.A.LiveConfig()
	folders, _ := s.A.DB.ListFolders()
	filesIndexed, bytesIndexed, lastScan := 0, int64(0), int64(0)
	for _, f := range folders {
		n, b, ls, err := s.A.DB.FolderStats(f.ID)
		if err == nil {
			filesIndexed += n
			bytesIndexed += b
			if ls > lastScan {
				lastScan = ls
			}
		}
	}
	peers, _ := s.A.DB.ListPeers()
	trusted, online := 0, 0
	for _, p := range peers {
		if p.Trust == store.Trusted {
			trusted++
			if s.A.IsOnline(p.PeerID) {
				online++
			}
		}
	}
	transfers := s.A.Manager.Live(0, "ALL")
	active, completed := 0, 0
	for _, t := range transfers {
		if t.Status == transfer.StatusTransferring || t.Status == transfer.StatusPreparing || t.Status == transfer.StatusQueued || t.Status == transfer.StatusVerifying {
			active++
		}
		if t.Status == transfer.StatusCompleted {
			completed++
		}
	}
	conflicts, _ := s.A.DB.ListConflicts(true)
	openConflicts := 0
	if conflicts != nil {
		openConflicts = len(conflicts)
	}
	sessions, _ := s.A.DB.ListSessions(1)
	lastSync := int64(0)
	if len(sessions) > 0 && sessions[0].FinishedAt > 0 {
		lastSync = sessions[0].FinishedAt
	}
	nativeEngine := "go-fallback"
	if s.A.Native.Available() {
		nativeEngine = s.A.Native.Version
	}
	return map[string]any{
		"peerId":         s.A.ID.PeerID,
		"name":           cfg.DeviceName,
		"version":        version.Version,
		"platform":       fmt.Sprintf("%s/%s", runtime.GOOS, runtime.GOARCH),
		"startedAt":      startAt.UTC().Format(time.RFC3339),
		"apiPort":        cfg.APIPort,
		"peerPort":       cfg.PeerPort,
		"keyFingerprint": s.A.ID.Fingerprint,
		"nativeEngine":   nativeEngine,
		"stats": map[string]any{
			"folders":            len(folders),
			"filesIndexed":       filesIndexed,
			"bytesIndexed":       bytesIndexed,
			"peersTrusted":       trusted,
			"peersOnline":        online,
			"transfersActive":    active,
			"transfersCompleted": completed,
			"conflictsOpen":      openConflicts,
			"lastSyncAt":         rfcOrEmpty(lastScan),
			"lastScanAt":         rfcOrEmpty(lastScan),
			"lastSessionAt":      rfcOrEmpty(lastSync),
		},
	}
}

func rfcOrEmpty(unix int64) string {
	if unix <= 0 {
		return ""
	}
	return time.Unix(unix, 0).UTC().Format(time.RFC3339)
}

func (s *Server) handleDevice(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "BAD_REQUEST", "GET only")
		return
	}
	writeJSON(w, http.StatusOK, s.deviceSnapshot())
}

// ---- peers ----

func (s *Server) peerView(p store.Peer) map[string]any {
	shared := 0
	folders, _ := s.A.DB.ListFolders()
	peerNames := s.A.PeerSharedFolders(p.PeerID)
	for _, f := range folders {
		for _, n := range peerNames {
			if n == f.Name {
				shared++
			}
		}
	}
	return map[string]any{
		"peerId": p.PeerID, "name": p.Name, "address": p.Address,
		"trust": string(p.Trust), "online": s.A.IsOnline(p.PeerID) && p.Trust == store.Trusted,
		"version": p.Version, "platform": p.Platform,
		"lastSeen": rfcOrEmpty(p.LastSeen), "addedAt": rfcOrEmpty(p.AddedAt),
		"sharedFolders": shared,
	}
}

func (s *Server) handlePeers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "BAD_REQUEST", "GET only")
		return
	}
	peers, err := s.A.DB.ListPeers()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "IO_ERROR", err.Error())
		return
	}
	out := []map[string]any{}
	for _, p := range peers {
		out = append(out, s.peerView(p))
	}
	writeJSON(w, http.StatusOK, map[string]any{"peers": out})
}

func (s *Server) handlePair(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "BAD_REQUEST", "POST only")
		return
	}
	var body struct {
		Address string `json:"address"`
	}
	if err := readJSON(r, &body); err != nil || body.Address == "" {
		writeErr(w, http.StatusBadRequest, "VALIDATION", "address (host:port) is required")
		return
	}
	host, port, err := net.SplitHostPort(body.Address)
	if err != nil || host == "" || port == "" {
		writeErr(w, http.StatusBadRequest, "VALIDATION", "address must be host:port")
		return
	}
	peer, err := s.A.Pair(body.Address)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "PEER_OFFLINE", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"peer": s.peerView(peer)})
}

func (s *Server) handlePeerActions(w http.ResponseWriter, r *http.Request) {
	segs := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	// /api/v1/peers/{id}/(approve|revoke) or /api/v1/peers/{id}
	if len(segs) < 4 {
		writeErr(w, http.StatusNotFound, "NOT_FOUND", "unknown route")
		return
	}
	peerID := segs[3]
	action := ""
	if len(segs) >= 5 {
		action = segs[4]
	}
	switch {
	case r.Method == http.MethodDelete && action == "":
		if err := s.A.Remove(peerID); err != nil {
			writeErr(w, http.StatusNotFound, "PEER_NOT_FOUND", err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
	case r.Method == http.MethodPost && action == "approve":
		if err := s.A.Approve(peerID); err != nil {
			writeErr(w, http.StatusNotFound, "PEER_NOT_FOUND", err.Error())
			return
		}
		p, _, _ := s.A.DB.GetPeer(peerID)
		writeJSON(w, http.StatusOK, map[string]any{"peer": s.peerView(p)})
	case r.Method == http.MethodPost && action == "revoke":
		if err := s.A.Revoke(peerID); err != nil {
			writeErr(w, http.StatusNotFound, "PEER_NOT_FOUND", err.Error())
			return
		}
		p, _, _ := s.A.DB.GetPeer(peerID)
		writeJSON(w, http.StatusOK, map[string]any{"peer": s.peerView(p)})
	default:
		writeErr(w, http.StatusNotFound, "NOT_FOUND", "unknown route")
	}
}

func (s *Server) handleDiscoveryScan(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "BAD_REQUEST", "POST only")
		return
	}
	found, err := s.A.ScanDiscovery()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "IO_ERROR", err.Error())
		return
	}
	out := []map[string]any{}
	for _, p := range found {
		out = append(out, map[string]any{
			"peerId": p.PeerID, "name": p.Name, "address": p.Address, "version": p.Version,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"found": out})
}

// ---- folders ----

func (s *Server) folderView(f store.Folder) map[string]any {
	n, b, ls, _ := s.A.DB.FolderStats(f.ID)
	return map[string]any{
		"id": f.ID, "name": f.Name, "path": f.Path,
		"fileCount": n, "totalBytes": b, "lastScanAt": rfcOrEmpty(ls),
	}
}

func (s *Server) handleFolders(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		folders, err := s.A.DB.ListFolders()
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "IO_ERROR", err.Error())
			return
		}
		out := []map[string]any{}
		for _, f := range folders {
			out = append(out, s.folderView(f))
		}
		writeJSON(w, http.StatusOK, map[string]any{"folders": out})
	case http.MethodPost:
		raw, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		var parsed struct {
			Name string `json:"name"`
			Path string `json:"path"`
		}
		if json.Unmarshal(raw, &parsed) != nil || parsed.Name == "" || parsed.Path == "" {
			writeErr(w, http.StatusBadRequest, "VALIDATION", "name and path are required")
			return
		}
		abs, err := filepath.Abs(parsed.Path)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "VALIDATION", "invalid path")
			return
		}
		st, err := os.Stat(abs)
		if err != nil || !st.IsDir() {
			writeErr(w, http.StatusBadRequest, "VALIDATION", "path must be an existing directory")
			return
		}
		if _, exists, _ := s.A.DB.FolderByName(parsed.Name); exists {
			writeErr(w, http.StatusConflict, "VALIDATION", "a folder with this name already exists")
			return
		}
		f, err := s.A.DB.AddFolder(parsed.Name, abs)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "IO_ERROR", err.Error())
			return
		}
		s.A.Bus.Emit("FOLDER_ADDED", "INFO", fmt.Sprintf("Shared folder %s added (%s)", f.Name, f.Path), map[string]any{"folder": f.Name})
		go func() {
			_, _, _, _ = s.A.Indexer.Rescan(f)
			_ = s.A.Indexer.StartWatching(f)
		}()
		writeJSON(w, http.StatusCreated, map[string]any{"folder": s.folderView(f)})
	default:
		writeErr(w, http.StatusMethodNotAllowed, "BAD_REQUEST", "GET or POST")
	}
}

func (s *Server) handleFolderActions(w http.ResponseWriter, r *http.Request) {
	segs := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(segs) < 4 {
		writeErr(w, http.StatusNotFound, "NOT_FOUND", "unknown route")
		return
	}
	id, err := strconv.ParseInt(segs[3], 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "VALIDATION", "invalid folder id")
		return
	}
	action := ""
	if len(segs) >= 5 {
		action = segs[4]
	}
	folder, ok, err := s.A.DB.GetFolder(id)
	if err != nil || !ok {
		writeErr(w, http.StatusNotFound, "FOLDER_NOT_FOUND", fmt.Sprintf("folder %d not found", id))
		return
	}
	switch {
	case r.Method == http.MethodDelete && action == "":
		if err := s.A.DB.DeleteFolder(id); err != nil {
			writeErr(w, http.StatusInternalServerError, "IO_ERROR", err.Error())
			return
		}
		s.A.Bus.Emit("FOLDER_REMOVED", "INFO", fmt.Sprintf("Stopped sharing folder %s (files kept on disk)", folder.Name), nil)
		w.WriteHeader(http.StatusNoContent)
	case r.Method == http.MethodPost && action == "rescan":
		start := time.Now()
		scanned, changed, removed, err := s.A.Indexer.Rescan(folder)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "IO_ERROR", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"folder": s.folderView(folder), "scanned": scanned, "changed": changed,
			"removed": removed, "durationMs": time.Since(start).Milliseconds(),
		})
	default:
		writeErr(w, http.StatusNotFound, "NOT_FOUND", "unknown route")
	}
}
