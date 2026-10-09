package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"

	"github.com/ParsaFathii/MeshSync/agent/internal/events"
	"github.com/ParsaFathii/MeshSync/agent/internal/store"
	syncengine "github.com/ParsaFathii/MeshSync/agent/internal/sync"
	"github.com/ParsaFathii/MeshSync/agent/internal/transfer"
)

func actionsJSON(plan *syncengine.Plan) []map[string]any {
	out := make([]map[string]any, 0, len(plan.Actions))
	for _, a := range plan.Actions {
		out = append(out, map[string]any{
			"relPath": a.RelPath, "state": a.State, "direction": a.Direction,
			"size": a.Size, "localHash": a.LocalHash, "remoteHash": a.RemoteHash,
			"lastSyncedHash": a.LastSyncedHash,
		})
	}
	return out
}

// ---- transfers ----

func (s *Server) transferView(t transfer.Transfer) map[string]any {
	folderName := ""
	if f, ok, _ := s.A.DB.GetFolder(t.FolderID); ok {
		folderName = f.Name
	}
	peerName := t.PeerID
	if p, ok, _ := s.A.DB.GetPeer(t.PeerID); ok {
		peerName = p.Name
	}
	return map[string]any{
		"id": t.ID, "peerId": t.PeerID, "peerName": peerName,
		"folderId": t.FolderID, "folderName": folderName, "relPath": t.RelPath,
		"direction": t.Direction, "size": t.Size, "transferred": t.Transferred,
		"progressPct": t.ProgressPct, "speedBps": t.SpeedBps, "etaSeconds": t.ETASeconds,
		"status": t.Status, "chunkSize": t.ChunkSize, "chunksTotal": t.ChunksTotal,
		"chunksDone": s.chunksDone(t), "startedAt": rfcOrEmpty(t.StartedAt),
		"completedAt": rfcOrEmpty(t.CompletedAt), "error": nilIfEmpty(t.Error),
	}
}

func (s *Server) chunksDone(t transfer.Transfer) int {
	states, _, ok := s.A.Manager.Chunks(t.ID)
	if !ok {
		return 0
	}
	n := 0
	for _, d := range states {
		if d {
			n++
		}
	}
	return n
}

func (s *Server) handleTransfers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "BAD_REQUEST", "GET only")
		return
	}
	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}
	status := r.URL.Query().Get("status")
	list := s.A.Manager.Live(limit, status)
	out := make([]map[string]any, 0, len(list))
	for _, t := range list {
		out = append(out, s.transferView(t))
	}
	writeJSON(w, http.StatusOK, map[string]any{"transfers": out})
}

func (s *Server) handleTransferActions(w http.ResponseWriter, r *http.Request) {
	segs := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(segs) < 4 {
		writeErr(w, http.StatusNotFound, "NOT_FOUND", "unknown route")
		return
	}
	id := segs[3]
	action := ""
	if len(segs) >= 5 {
		action = segs[4]
	}
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "BAD_REQUEST", "POST only")
		return
	}
	var err error
	switch action {
	case "pause":
		err = s.A.Manager.Pause(id)
	case "resume":
		err = s.A.Manager.Resume(id)
	case "cancel":
		err = s.A.Manager.Cancel(id)
	case "retry":
		err = s.A.Manager.Retry(id)
	default:
		writeErr(w, http.StatusNotFound, "NOT_FOUND", "unknown action")
		return
	}
	if err != nil {
		writeErr(w, http.StatusBadRequest, "TRANSFER_NOT_FOUND", err.Error())
		return
	}
	t, ok, _ := s.A.Manager.Get(id)
	if !ok {
		writeErr(w, http.StatusNotFound, "TRANSFER_NOT_FOUND", "transfer not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"transfer": s.transferView(t)})
}

// ---- conflicts ----

func (s *Server) conflictView(c store.Conflict) map[string]any {
	folderName := ""
	if f, ok, _ := s.A.DB.GetFolder(c.FolderID); ok {
		folderName = f.Name
	}
	peerName := c.RemotePeerID
	if p, ok, _ := s.A.DB.GetPeer(c.RemotePeerID); ok {
		peerName = p.Name
	} else if c.RemotePeerID == "remote" {
		peerName = "remote peer"
	}
	return map[string]any{
		"id": c.ID, "folderId": c.FolderID, "folderName": folderName, "relPath": c.RelPath,
		"localHash": c.LocalHash, "remoteHash": c.RemoteHash,
		"localSize": c.LocalSize, "remoteSize": c.RemoteSize,
		"localMtime": msToRFC(c.LocalMtime), "remoteMtime": msToRFC(c.RemoteMtime),
		"remotePeerId": c.RemotePeerID, "remotePeerName": peerName,
		"status": c.Status, "resolution": nilIfEmpty(c.Resolution),
		"createdAt": rfcOrEmpty(c.CreatedAt), "resolvedAt": rfcOrEmpty(c.ResolvedAt),
	}
}

func (s *Server) handleConflicts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "BAD_REQUEST", "GET only")
		return
	}
	conflicts, err := s.A.DB.ListConflicts(false)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "IO_ERROR", err.Error())
		return
	}
	out := []map[string]any{}
	for _, c := range conflicts {
		out = append(out, s.conflictView(c))
	}
	writeJSON(w, http.StatusOK, map[string]any{"conflicts": out})
}

func (s *Server) handleConflictResolve(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "BAD_REQUEST", "POST only")
		return
	}
	segs := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(segs) < 4 {
		writeErr(w, http.StatusNotFound, "NOT_FOUND", "unknown route")
		return
	}
	id, err := strconv.ParseInt(segs[3], 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "VALIDATION", "invalid conflict id")
		return
	}
	var body struct {
		Action string `json:"action"`
	}
	if readJSON(r, &body) != nil {
		writeErr(w, http.StatusBadRequest, "VALIDATION", "action is required")
		return
	}
	switch body.Action {
	case "KEEP_LOCAL", "KEEP_REMOTE", "KEEP_BOTH", "LATER":
	default:
		writeErr(w, http.StatusBadRequest, "VALIDATION", "action must be KEEP_LOCAL, KEEP_REMOTE, KEEP_BOTH or LATER")
		return
	}
	if err := s.A.Engine.ResolveConflict(id, body.Action); err != nil {
		writeErr(w, http.StatusBadGateway, "PEER_OFFLINE", err.Error())
		return
	}
	c, _, _ := s.A.DB.GetConflict(id)
	writeJSON(w, http.StatusOK, map[string]any{"conflict": s.conflictView(c)})
}

// ---- events + WebSocket ----

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "BAD_REQUEST", "GET only")
		return
	}
	since, _ := strconv.ParseInt(r.URL.Query().Get("sinceEventId"), 10, 64)
	limit := 100
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 1000 {
			limit = n
		}
	}
	evs, err := s.A.Bus.Backfill(since, limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "IO_ERROR", err.Error())
		return
	}
	out := []map[string]any{}
	for _, e := range evs {
		out = append(out, eventView(e))
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": out})
}

func eventView(e events.Event) map[string]any {
	return map[string]any{
		"id": e.ID, "type": e.Type, "severity": e.Severity,
		"message": e.Message, "data": e.Data, "ts": e.TS.UTC().Format(time.RFC3339),
	}
}

var wsUpgrader = websocket.Upgrader{
	ReadBufferSize:  32 * 1024,
	WriteBufferSize: 32 * 1024,
	CheckOrigin:     func(r *http.Request) bool { return true }, // local agent; see SECURITY.md
}

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	client := &wsClient{conn: conn, send: make(chan []byte, 512)}
	s.wsMu.Lock()
	s.wsConns[client] = true
	s.wsMu.Unlock()

	// hello frame with a full device snapshot
	hello, _ := json.Marshal(map[string]any{"kind": "hello", "device": s.deviceSnapshot(), "ts": time.Now().UTC().Format(time.RFC3339)})
	select {
	case client.send <- hello:
	default:
	}

	go s.wsWriter(client)
	go s.wsReader(client)
}

func (s *Server) wsWriter(c *wsClient) {
	for msg := range c.send {
		if err := c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second)); err != nil {
			break
		}
		if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			break
		}
	}
	s.wsMu.Lock()
	delete(s.wsConns, c)
	s.wsMu.Unlock()
	c.conn.Close()
}

func (s *Server) wsReader(c *wsClient) {
	defer func() {
		s.wsMu.Lock()
		if _, ok := s.wsConns[c]; ok {
			delete(s.wsConns, c)
			close(c.send)
		}
		s.wsMu.Unlock()
		c.conn.Close()
	}()
	c.conn.SetReadLimit(4096)
	for {
		if err := c.conn.SetReadDeadline(time.Now().Add(90 * time.Second)); err != nil {
			return
		}
		_, payload, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		var msg struct {
			Kind string `json:"kind"`
		}
		if json.Unmarshal(payload, &msg) == nil && msg.Kind == "ping" {
			pong, _ := json.Marshal(map[string]any{"kind": "pong"})
			select {
			case c.send <- pong:
			default:
			}
		}
	}
}

// Broadcast pushes one frame to every connected WebSocket client.
func (s *Server) Broadcast(kind string, payload any) {
	var frame []byte
	switch kind {
	case "transfer":
		if t, ok := payload.(*transfer.Transfer); ok {
			frame = marshalFrame("transfer", "transfer", s.transferView(*t))
		}
	case "event":
		if e, ok := payload.(events.Event); ok {
			frame = marshalFrame("event", "event", eventView(e))
		}
	case "peers":
		peers, err := s.A.DB.ListPeers()
		if err != nil {
			return
		}
		out := []map[string]any{}
		for _, p := range peers {
			out = append(out, s.peerView(p))
		}
		frame = marshalFrame("peers", "peers", out)
	case "device":
		frame = marshalFrame("device", "device", s.deviceSnapshot())
	}
	if frame == nil {
		return
	}
	s.wsMu.Lock()
	for c := range s.wsConns {
		select {
		case c.send <- frame:
		default: // drop for slow clients; they can refetch via REST
		}
	}
	s.wsMu.Unlock()
}

// eventPump forwards bus events to every WebSocket client.
func (s *Server) eventPump() {
	sub := s.A.Bus.Subscribe()
	defer s.A.Bus.Unsubscribe(sub)
	for e := range sub {
		s.Broadcast("event", e)
	}
}

func marshalFrame(kind, field string, v any) []byte {
	raw, err := json.Marshal(map[string]any{"kind": kind, field: v})
	if err != nil {
		return nil
	}
	return raw
}

// ---- settings ----

func (s *Server) settingsView() map[string]any {
	c := s.A.LiveConfig()
	return map[string]any{
		"deviceName": c.DeviceName, "bandwidthLimitBps": c.BandwidthLimitBps,
		"concurrentTransfers": c.ConcurrentTransfers, "chunkSizeBytes": c.ChunkSizeBytes,
		"discoveryEnabled": c.DiscoveryEnabled, "skipHiddenFiles": c.SkipHiddenFiles,
		"autoSyncSeconds": c.AutoSyncSeconds,
	}
}

func (s *Server) handleSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, s.settingsView())
	case http.MethodPut:
		var body struct {
			DeviceName          *string `json:"deviceName"`
			BandwidthLimitBps   *int64  `json:"bandwidthLimitBps"`
			ConcurrentTransfers *int    `json:"concurrentTransfers"`
			ChunkSizeBytes      *int64  `json:"chunkSizeBytes"`
			DiscoveryEnabled    *bool   `json:"discoveryEnabled"`
			SkipHiddenFiles     *bool   `json:"skipHiddenFiles"`
			AutoSyncSeconds     *int    `json:"autoSyncSeconds"`
		}
		if readJSON(r, &body) != nil {
			writeErr(w, http.StatusBadRequest, "VALIDATION", "invalid settings body")
			return
		}
		cfg := s.A.LiveConfig()
		if body.DeviceName != nil {
			cfg.DeviceName = *body.DeviceName
		}
		if body.BandwidthLimitBps != nil {
			cfg.BandwidthLimitBps = *body.BandwidthLimitBps
		}
		if body.ConcurrentTransfers != nil {
			cfg.ConcurrentTransfers = *body.ConcurrentTransfers
		}
		if body.ChunkSizeBytes != nil {
			cfg.ChunkSizeBytes = *body.ChunkSizeBytes
		}
		if body.DiscoveryEnabled != nil {
			cfg.DiscoveryEnabled = *body.DiscoveryEnabled
		}
		if body.SkipHiddenFiles != nil {
			cfg.SkipHiddenFiles = *body.SkipHiddenFiles
		}
		if body.AutoSyncSeconds != nil {
			cfg.AutoSyncSeconds = *body.AutoSyncSeconds
		}
		if err := cfg.Validate(); err != nil {
			writeErr(w, http.StatusBadRequest, "VALIDATION", err.Error())
			return
		}
		if err := s.A.ApplySettings(cfg); err != nil {
			writeErr(w, http.StatusInternalServerError, "IO_ERROR", err.Error())
			return
		}
		s.A.Bus.Emit("SETTINGS_UPDATED", "INFO", "Settings updated", nil)
		s.Broadcast("device", nil)
		writeJSON(w, http.StatusOK, map[string]any{
			"deviceName": cfg.DeviceName, "bandwidthLimitBps": cfg.BandwidthLimitBps,
			"concurrentTransfers": cfg.ConcurrentTransfers, "chunkSizeBytes": cfg.ChunkSizeBytes,
			"discoveryEnabled": cfg.DiscoveryEnabled, "skipHiddenFiles": cfg.SkipHiddenFiles,
			"autoSyncSeconds": cfg.AutoSyncSeconds,
		})
	default:
		writeErr(w, http.StatusMethodNotAllowed, "BAD_REQUEST", "GET or PUT")
	}
}
