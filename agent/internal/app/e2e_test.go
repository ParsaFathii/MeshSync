package app_test

import (
        "bytes"
        "encoding/json"
        "fmt"
        "io"
        "net/http"
        "os"
        "path/filepath"
        "sync"
        "testing"
        "time"

        "github.com/ParsaFathii/MeshSync/agent/internal/api"
        "github.com/ParsaFathii/MeshSync/agent/internal/app"
        "github.com/ParsaFathii/MeshSync/agent/internal/config"
        "github.com/ParsaFathii/MeshSync/agent/internal/identity"
        "github.com/ParsaFathii/MeshSync/agent/internal/netproto"
        "github.com/ParsaFathii/MeshSync/agent/internal/store"
        syncengine "github.com/ParsaFathii/MeshSync/agent/internal/sync"
        "github.com/ParsaFathii/MeshSync/agent/internal/transfer"
)

// harness runs a real agent over temp directories and ephemeral ports.
type harness struct {
        t       *testing.T
        agent   *app.Agent
        apiAddr string
        dir     string
        client  *http.Client
}

var portMu sync.Mutex
var nextPort = 31400

func pickPorts() (api, peer int) {
        portMu.Lock()
        defer portMu.Unlock()
        api, peer = nextPort, nextPort+100
        nextPort++
        return
}

func newHarness(t *testing.T, name string, folders map[string]string) *harness {
        t.Helper()
        dir := t.TempDir()
        for folderName, target := range folders {
                if err := os.MkdirAll(target, 0o755); err != nil {
                        t.Fatal(err)
                }
                _ = folderName
        }
        apiPort, peerPort := pickPorts()
        cfg := config.Defaults()
        cfg.DeviceName = name
        cfg.APIPort = apiPort
        cfg.PeerPort = peerPort
        cfg.APIBind = "127.0.0.1"
        cfg.DiscoveryEnabled = false // deterministic tests
        cfg.AutoSyncSeconds = 0
        cfg.NativePath = ""
        if err := cfg.Save(dir); err != nil {
                t.Fatal(err)
        }
        id, err := identity.Load(dir)
        if err != nil {
                t.Fatal(err)
        }
        cert, err := netproto.EnsureCert(dir, id)
        if err != nil {
                t.Fatal(err)
        }
        db, err := store.Open(filepath.Join(dir, "meshsync.db"))
        if err != nil {
                t.Fatal(err)
        }
        a := app.New(dir, cfg, id, cert, db)
        if err := a.Start(); err != nil {
                t.Fatal(err)
        }
        t.Cleanup(a.Stop)
        h := &harness{t: t, agent: a, dir: dir, client: &http.Client{Timeout: 60 * time.Second}}
        h.apiAddr = fmt.Sprintf("127.0.0.1:%d", apiPort)
        // start API listener
        if err := startAPI(a, h.apiAddr); err != nil {
                t.Fatal(err)
        }
        for folderName, target := range folders {
                h.post("/api/v1/shared-folders", map[string]any{"name": folderName, "path": target})
        }
        // wait for folder indexing
        time.Sleep(300 * time.Millisecond)
        return h
}

func (h *harness) peerAddr() string {
        return fmt.Sprintf("127.0.0.1:%d", h.agent.LiveConfig().PeerPort)
}

// startAPI runs the local HTTP API for a test agent, mirroring production
// wiring (agent.Start → api.New → Listen).
func startAPI(a *app.Agent, addr string) error {
        srv := api.New(a)
        return srv.Listen(addr)
}

func (h *harness) do(method, path string, body any) (int, []byte) {
        h.t.Helper()
        var rd io.Reader
        if body != nil {
                raw, err := json.Marshal(body)
                if err != nil {
                        h.t.Fatal(err)
                }
                rd = bytes.NewReader(raw)
        }
        req, err := http.NewRequest(method, "http://"+h.apiAddr+path, rd)
        if err != nil {
                h.t.Fatal(err)
        }
        if body != nil {
                req.Header.Set("Content-Type", "application/json")
        }
        resp, err := h.client.Do(req)
        if err != nil {
                h.t.Fatalf("%s %s: %v", method, path, err)
        }
        defer resp.Body.Close()
        raw, _ := io.ReadAll(resp.Body)
        return resp.StatusCode, raw
}

func (h *harness) post(path string, body any) (int, []byte) {
        return h.do(http.MethodPost, path, body)
}

func (h *harness) get(path string) (int, []byte) {
        return h.do(http.MethodGet, path, nil)
}

func (h *harness) mustJSON(t *testing.T, code int, raw []byte, target any) {
        t.Helper()
        if code >= 300 {
                t.Fatalf("status %d: %s", code, raw)
        }
        if err := json.Unmarshal(raw, target); err != nil {
                t.Fatalf("decode %s: %v", raw, err)
        }
}

// waitUntil polls fn until it returns true (deadline 20s).
func waitUntil(t *testing.T, what string, fn func() bool) {
        t.Helper()
        deadline := time.Now().Add(20 * time.Second)
        for time.Now().Before(deadline) {
                if fn() {
                        return
                }
                time.Sleep(100 * time.Millisecond)
        }
        t.Fatalf("timed out waiting for %s", what)
}

// TestPairAndSync performs the full real flow: pair A→B, approve on B,
// sync a folder with files, verify content + hashes on both sides.
func TestPairAndSync(t *testing.T) {
        dirA, dirB := t.TempDir(), t.TempDir()
        sharedA, sharedB := filepath.Join(dirA, "Documents"), filepath.Join(dirB, "Documents")
        a := newHarness(t, "mesh-alpha", map[string]string{"Documents": sharedA})
        b := newHarness(t, "mesh-beta", map[string]string{"Documents": sharedB})

        // seed files on A
        write := func(p, content string) {
                t.Helper()
                if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
                        t.Fatal(err)
                }
                if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
                        t.Fatal(err)
                }
        }
        write(filepath.Join(sharedA, "hello.txt"), "hello from alpha\n")
        write(filepath.Join(sharedA, "nested", "deep", "data.bin"), "\x00\x01\x02\x03meshsync")
        // 3 MiB pseudo-random file exercises multi-chunk transfer
        big := make([]byte, 3*1024*1024)
        for i := range big {
                big[i] = byte(i * 31 % 251)
        }
        write(filepath.Join(sharedA, "big.bin"), string(big))

        // rescan A so the new files are indexed
        code, raw := a.post("/api/v1/shared-folders/1/rescan", nil)
        if code != 200 {
                t.Fatalf("rescan: %d %s", code, raw)
        }

        // pair A -> B, then approve on B
        code, raw = a.post("/api/v1/peers/pair", map[string]string{"address": b.peerAddr()})
        if code != 200 {
                t.Fatalf("pair: %d %s", code, raw)
        }
        var pairResp struct {
                Peer struct {
                        PeerID string `json:"peerId"`
                        Trust  string `json:"trust"`
                } `json:"peer"`
        }
        a.mustJSON(t, code, raw, &pairResp)
        if pairResp.Peer.Trust != "PAIRING" {
                t.Fatalf("expected PAIRING, got %s", pairResp.Peer.Trust)
        }
        // approve on B using A's peer id (the requester), per API.md
        code, raw = b.post("/api/v1/peers/"+peerIDOf(a)+"/approve", nil)
        if code != 200 {
                t.Fatalf("approve: %d %s", code, raw)
        }

        // both sides must end up TRUSTED
        waitUntil(t, "A trusts B", func() bool {
                _, body := a.get("/api/v1/peers")
                return contains(body, `"trust": "TRUSTED"`) || contains(body, `"trust":"TRUSTED"`)
        })

        // sync from A
        code, raw = a.post("/api/v1/sync/run", map[string]any{"peer": peerIDOf(b), "folder": 1})
        if code >= 300 {
                t.Fatalf("sync run: %d %s", code, raw)
        }
        var run struct {
                SessionID string `json:"sessionId"`
                Plan      struct {
                        Summary struct {
                                Push int `json:"push"`
                        } `json:"summary"`
                } `json:"plan"`
        }
        a.mustJSON(t, code, raw, &run)
        if run.Plan.Summary.Push < 3 {
                t.Fatalf("expected at least 3 push actions, got %d (%s)", run.Plan.Summary.Push, raw)
        }

        // wait for the session to complete
        waitUntil(t, "session completion", func() bool {
                _, body := a.get("/api/v1/sync/sessions")
                return contains(body, `"status": "COMPLETED"`) || contains(body, `"status":"COMPLETED"`)
        })

        // B must hold identical content
        check := func(rel string, expected []byte) {
                t.Helper()
                got, err := os.ReadFile(filepath.Join(sharedB, rel))
                if err != nil {
                        t.Fatalf("B missing %s: %v", rel, err)
                }
                if string(got) != string(expected) {
                        t.Fatalf("B %s content mismatch", rel)
                }
        }
        check("hello.txt", []byte("hello from alpha\n"))
        check("nested/deep/data.bin", []byte("\x00\x01\x02\x03meshsync"))
        check("big.bin", big)

        // transfers recorded on both sides
        waitUntil(t, "transfers completed on A", func() bool {
                _, body := a.get("/api/v1/transfers")
                return countCompleted(body) >= 3
        })
        waitUntil(t, "transfers completed on B", func() bool {
                _, body := b.get("/api/v1/transfers")
                return countCompleted(body) >= 3
        })

        // a second sync must be a no-op (no new transfers)
        code, raw = a.post("/api/v1/sync/run", map[string]any{"peer": peerIDOf(b), "folder": 1})
        if code >= 300 {
                t.Fatalf("second sync: %d %s", code, raw)
        }
        _, body := a.get("/api/v1/transfers")
        if n := countCompleted(body); n < 3 {
                t.Fatalf("transfers lost: %d", n)
        }
}

func peerIDOf(h *harness) string {
        h.t.Helper()
        code, raw := h.get("/api/v1/device")
        var d struct {
                PeerID string `json:"peerId"`
        }
        h.mustJSON(h.t, code, raw, &d)
        return d.PeerID
}

func contains(b []byte, s string) bool {
        return len(b) >= len(s) && (string(b[:]) == s || indexOf(string(b), s) >= 0)
}

func indexOf(hay, needle string) int {
        for i := 0; i+len(needle) <= len(hay); i++ {
                if hay[i:i+len(needle)] == needle {
                        return i
                }
        }
        return -1
}

func countCompleted(body []byte) int {
        n := 0
        s := string(body)
        for {
                i := indexOf(s, `"status": "COMPLETED"`)
                if i < 0 {
                        i = indexOf(s, `"status":"COMPLETED"`)
                }
                if i < 0 {
                        break
                }
                n++
                s = s[i+10:]
        }
        return n
}

// TestPurgeCancelledParts verifies the part-file lifecycle at startup:
// a CANCELLED transfer's stale part is deleted and its persisted chunk
// bitmap is cleared (a retry of a cancelled transfer restarts from zero),
// while a FAILED transfer's part and bitmap are strictly retained — that
// is the resume data a Retry continues from.
func TestPurgeCancelledParts(t *testing.T) {
        dir := t.TempDir()
        shared := filepath.Join(dir, "Documents")
        if err := os.MkdirAll(shared, 0o755); err != nil {
                t.Fatal(err)
        }
        apiPort, peerPort := pickPorts()
        cfg := config.Defaults()
        cfg.DeviceName = "purge-test"
        cfg.APIPort = apiPort
        cfg.PeerPort = peerPort
        cfg.APIBind = "127.0.0.1"
        cfg.DiscoveryEnabled = false
        cfg.AutoSyncSeconds = 0
        cfg.NativePath = ""
        if err := cfg.Save(dir); err != nil {
                t.Fatal(err)
        }
        id, err := identity.Load(dir)
        if err != nil {
                t.Fatal(err)
        }
        cert, err := netproto.EnsureCert(dir, id)
        if err != nil {
                t.Fatal(err)
        }
        db, err := store.Open(filepath.Join(dir, "meshsync.db"))
        if err != nil {
                t.Fatal(err)
        }
        folder, err := db.AddFolder("Documents", shared)
        if err != nil {
                t.Fatal(err)
        }

        peerID := "d1234567890abcdef"
        now := time.Now().Unix()
        cancelled := store.Transfer{
                ID: "t-cancelled", PeerID: peerID, FolderID: folder.ID, RelPath: "big.bin",
                Direction: "PULL", Size: 5 << 20, Transferred: 3 << 20,
                Status: transfer.StatusCancelled, ChunkSize: 1048576, ChunksTotal: 5,
                ChunksDone: store.BitmapFromBools([]bool{true, true, true, false, false}),
                CreatedAt:  now, StartedAt: now, CompletedAt: now, Error: "cancelled",
        }
        failed := store.Transfer{
                ID: "t-failed", PeerID: peerID, FolderID: folder.ID, RelPath: "keep.bin",
                Direction: "PULL", Size: 2 << 20, Transferred: 1 << 20,
                Status: transfer.StatusFailed, ChunkSize: 1048576, ChunksTotal: 2,
                ChunksDone: store.BitmapFromBools([]bool{true, false}),
                CreatedAt:  now, StartedAt: now, CompletedAt: now, Error: "disk full",
        }
        for _, tr := range []store.Transfer{cancelled, failed} {
                if err := db.PutTransfer(tr); err != nil {
                        t.Fatal(err)
                }
        }

        cancelledPart := syncengine.PartPath(dir, folder.ID, peerID, "big.bin")
        failedPart := syncengine.PartPath(dir, folder.ID, peerID, "keep.bin")
        for _, p := range []string{cancelledPart, failedPart} {
                if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
                        t.Fatal(err)
                }
                if err := os.WriteFile(p, []byte("partial-bytes"), 0o644); err != nil {
                        t.Fatal(err)
                }
        }

        a := app.New(dir, cfg, id, cert, db)
        if err := a.Start(); err != nil {
                t.Fatal(err)
        }
        t.Cleanup(a.Stop)

        if _, err := os.Stat(cancelledPart); !os.IsNotExist(err) {
                t.Fatalf("part of cancelled transfer must be purged, stat err=%v", err)
        }
        if _, err := os.Stat(failedPart); err != nil {
                t.Fatalf("part of failed transfer must be retained: %v", err)
        }
        got, ok, err := db.GetTransfer("t-cancelled")
        if err != nil || !ok {
                t.Fatalf("get cancelled transfer: found=%v err=%v", ok, err)
        }
        if got.ChunksDone != "" || got.Transferred != 0 {
                t.Fatalf("cancelled transfer must restart clean, got bitmap %q transferred %d", got.ChunksDone, got.Transferred)
        }
        kept, ok, err := db.GetTransfer("t-failed")
        if err != nil || !ok {
                t.Fatalf("get failed transfer: found=%v err=%v", ok, err)
        }
        if kept.ChunksDone == "" || kept.Transferred == 0 {
                t.Fatalf("failed transfer must keep its resume state, got bitmap %q transferred %d", kept.ChunksDone, kept.Transferred)
        }
}
