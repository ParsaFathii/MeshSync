// Package transfer coordinates file transfers: a persistent queue, a worker
// pool with configurable concurrency, global bandwidth limiting, live
// progress with speed/ETA, and pause / resume / cancel / retry actions that
// survive agent restarts (the chunk bitmap is persisted in the database).
package transfer

import (
        "errors"
        "fmt"
        "sync"
        "time"

        "github.com/ParsaFathii/MeshSync/agent/internal/events"
        "github.com/ParsaFathii/MeshSync/agent/internal/store"
)

// Transfer statuses.
const (
        StatusQueued       = "QUEUED"
        StatusPreparing    = "PREPARING"
        StatusTransferring = "TRANSFERRING"
        StatusVerifying    = "VERIFYING"
        StatusPaused       = "PAUSED"
        StatusCompleted    = "COMPLETED"
        StatusFailed       = "FAILED"
        StatusCancelled    = "CANCELLED"
)

var (
        ErrPaused    = errors.New("transfer paused")
        ErrCancelled = errors.New("transfer cancelled")
)

// Executor performs the actual chunk protocol for one transfer. The sync
// engine implements it; the manager owns scheduling and state.
type Executor interface {
        Execute(t *Transfer, r *Runner) error
}

// Transfer is the manager's live view of store.Transfer plus runtime
// measurements. Everything shown to users comes from these fields.
type Transfer struct {
        store.Transfer
        SpeedBps    int64 `json:"speedBps"`
        ETASeconds  int64 `json:"etaSeconds"`
        ProgressPct int   `json:"progressPct"`
}

// Runner is handed to Executor; it reports progress and exposes the
// control flags and bandwidth limiter.
type Runner struct {
        mu    sync.Mutex
        t     *Transfer
        m     *Manager
        done  []bool
        speed *speedMeter
}

type speedMeter struct {
        mu     sync.Mutex
        window []sample
}

type sample struct {
        at    time.Time
        bytes int64
}

func (s *speedMeter) add(n int64) {
        s.mu.Lock()
        defer s.mu.Unlock()
        now := time.Now()
        s.window = append(s.window, sample{now, n})
        cut := now.Add(-4 * time.Second)
        for len(s.window) > 0 && s.window[0].at.Before(cut) {
                s.window = s.window[1:]
        }
}

func (s *speedMeter) bps() int64 {
        s.mu.Lock()
        defer s.mu.Unlock()
        if len(s.window) < 2 {
                return 0
        }
        first := s.window[0]
        last := s.window[len(s.window)-1]
        dt := last.at.Sub(first.at).Seconds()
        if dt <= 0.05 {
                return 0
        }
        var bytes int64
        for i := 1; i < len(s.window); i++ {
                bytes += s.window[i].bytes
        }
        return int64(float64(bytes) / dt)
}

type flagSet struct {
        mu       sync.Mutex
        pauseReq bool
        cancel   bool
}

func (f *flagSet) pauseRequested() bool {
        f.mu.Lock()
        defer f.mu.Unlock()
        return f.pauseReq
}

func (f *flagSet) cancelRequested() bool {
        f.mu.Lock()
        defer f.mu.Unlock()
        return f.cancel
}

// Manager runs the transfer queue.
type Manager struct {
        db        *store.DB
        bus       *events.Bus
        bandwidth *Bandwidth
        exec      Executor
        conc      int

        mu       sync.Mutex
        queue    []*Transfer
        active   map[string]*Transfer
        flags    map[string]*flagSet
        stateSub []func(t *Transfer)
        stopCh   chan struct{}
        wg       sync.WaitGroup

        persistMu sync.Mutex
        dirty     map[string]bool
}

// OnState registers a callback fired on every transfer state/progress
// change (used for WebSocket broadcast).
func (m *Manager) OnState(fn func(t *Transfer)) {
        m.mu.Lock()
        m.stateSub = append(m.stateSub, fn)
        m.mu.Unlock()
}

func NewManager(db *store.DB, bus *events.Bus, bandwidth *Bandwidth, exec Executor, concurrency int) *Manager {
        if concurrency < 1 {
                concurrency = 1
        }
        return &Manager{
                db: db, bus: bus, bandwidth: bandwidth, exec: exec, conc: concurrency,
                active: map[string]*Transfer{}, flags: map[string]*flagSet{},
                stopCh: make(chan struct{}), dirty: map[string]bool{},
        }
}

// SetExecutor wires the transfer executor after construction (the engine
// and the manager hold mutual references; this breaks the cycle before
// Start). Must not be called once the manager is running.
func (m *Manager) SetExecutor(exec Executor) {
        m.mu.Lock()
        m.exec = exec
        m.mu.Unlock()
}

func (m *Manager) SetConcurrency(n int) {
        if n >= 1 && n <= 8 {
                m.mu.Lock()
                m.conc = n
                m.mu.Unlock()
                m.dispatch()
        }
}

// Start launches the worker dispatcher loop.
func (m *Manager) Start() {
        m.wg.Add(1)
        go func() {
                defer m.wg.Done()
                tick := time.NewTicker(250 * time.Millisecond)
                defer tick.Stop()
                for {
                        select {
                        case <-m.stopCh:
                                return
                        case <-tick.C:
                                m.dispatch()
                                m.flushDirty()
                        }
                }
        }()
}

func (m *Manager) Stop() {
        close(m.stopCh)
        m.wg.Wait()
}

// Submit registers a transfer and schedules it.
func (m *Manager) Submit(t store.Transfer) *Transfer {
        live := &Transfer{Transfer: t}
        m.mu.Lock()
        m.queue = append(m.queue, live)
        m.flags[t.ID] = &flagSet{}
        m.mu.Unlock()
        m.persistNow(live)
        m.bus.Emit("TRANSFER_STARTED", "INFO",
                fmt.Sprintf("%s %s with %s (%s)", directionVerb(t.Direction), t.RelPath, shortID(t.PeerID), humanBytes(t.Size)),
                map[string]any{"transferId": t.ID, "path": t.RelPath, "direction": t.Direction, "size": t.Size})
        m.notify(live)
        m.dispatch()
        return live
}

func directionVerb(d string) string {
        if d == "PUSH" {
                return "Pushing"
        }
        return "Pulling"
}

func shortID(id string) string {
        if len(id) > 8 {
                return id[:8]
        }
        return id
}

// dispatch moves queued transfers into active workers while slots exist.
func (m *Manager) dispatch() {
        m.mu.Lock()
        defer m.mu.Unlock()
        for len(m.queue) > 0 && len(m.active) < m.conc {
                t := m.queue[0]
                m.queue = m.queue[1:]
                if t.Status == StatusCancelled || t.Status == StatusCompleted || t.Status == StatusPaused {
                        continue
                }
                f, ok := m.flags[t.ID]
                if !ok {
                        f = &flagSet{}
                        m.flags[t.ID] = f
                }
                if f.cancelRequested() {
                        t.Status = StatusCancelled
                        t.CompletedAt = time.Now().Unix()
                        continue
                }
                m.active[t.ID] = t
                t.Status = StatusPreparing
                m.wg.Add(1)
                go m.run(t, f)
        }
}

func (m *Manager) run(t *Transfer, f *flagSet) {
        defer m.wg.Done()
        defer func() {
                m.mu.Lock()
                delete(m.active, t.ID)
                m.mu.Unlock()
                m.dispatch()
        }()

        if f.pauseRequested() {
                t.Status = StatusPaused
                m.persistNow(t)
                m.notify(t)
                return
        }

        r := &Runner{
                t:     t,
                m:     m,
                done:  store.BoolsFromBitmap(t.ChunksDone, t.ChunksTotal),
                speed: &speedMeter{},
        }

        t.Status = StatusTransferring
        if t.StartedAt == 0 {
                t.StartedAt = time.Now().Unix()
        }
        m.notify(t)

        if m.exec == nil {
                t.Status = StatusFailed
                t.Error = "no transfer executor configured"
                t.CompletedAt = time.Now().Unix()
                m.persistNow(t)
                m.notify(t)
                return
        }
        err := m.exec.Execute(t, r)

        switch {
        case f.cancelRequested() || errors.Is(err, ErrCancelled):
                t.Status = StatusCancelled
                t.Error = "cancelled"
                t.CompletedAt = time.Now().Unix()
                // A cancelled transfer is abandoned: the engine deletes its part
                // file, so the persisted chunk bitmap must be dropped too —
                // otherwise a later Retry (which accepts CANCELLED transfers)
                // would skip chunks that no longer exist on disk and could never
                // pass the end-of-transfer integrity check.
                t.ChunksDone = ""
                t.Transferred = 0
                m.bus.Emit("TRANSFER_CANCELLED", "WARN", fmt.Sprintf("Cancelled %s", t.RelPath), map[string]any{"transferId": t.ID})
        case f.pauseRequested() || errors.Is(err, ErrPaused):
                t.Status = StatusPaused
                m.bus.Emit("TRANSFER_PAUSED", "WARN",
                        fmt.Sprintf("Paused %s at %d/%d chunks", t.RelPath, countDone(r.done), t.ChunksTotal),
                        map[string]any{"transferId": t.ID})
        case err != nil:
                t.Status = StatusFailed
                t.Error = err.Error()
                t.CompletedAt = time.Now().Unix()
                m.bus.Emit("TRANSFER_FAILED", "ERROR", fmt.Sprintf("Failed %s: %v", t.RelPath, err), map[string]any{"transferId": t.ID, "error": err.Error()})
        default:
                t.Status = StatusCompleted
                t.Error = ""
                t.CompletedAt = time.Now().Unix()
                // Finalize the real progress: a completed transfer IS fully
                // transferred, so the reported metrics must never linger at
                // an intermediate (or zero) value.
                if t.Size > 0 && t.Transferred != t.Size {
                        t.Transferred = t.Size
                }
                t.ProgressPct = 100
                if t.ChunksTotal > 0 {
                        allDone := make([]bool, t.ChunksTotal)
                        for i := range allDone {
                                allDone[i] = true
                        }
                        t.ChunksDone = store.BitmapFromBools(allDone)
                }
                m.bus.Emit("TRANSFER_COMPLETED", "INFO",
                        fmt.Sprintf("Completed %s %s (%s)", directionVerb(t.Direction), t.RelPath, humanBytes(t.Size)),
                        map[string]any{"transferId": t.ID, "path": t.RelPath, "bytes": t.Size})
        }
        m.persistNow(t)
        m.notify(t)
}

func countDone(b []bool) int {
        n := 0
        for _, v := range b {
                if v {
                        n++
                }
        }
        return n
}

// ---- Runner API used by the executor ----

func (r *Runner) Paused() bool    { return r.m.flagsFor(r.t.ID).pauseRequested() }
func (r *Runner) Cancelled() bool { return r.m.flagsFor(r.t.ID).cancelRequested() }

// Bandwidth returns the shared limiter.
func (r *Runner) Bandwidth() *Bandwidth { return r.m.bandwidth }

// ChunkDone records chunk i as transferred with n bytes and updates live
// metrics (progress, speed, ETA).
func (r *Runner) ChunkDone(i int, n int64) {
        r.mu.Lock()
        defer r.mu.Unlock()
        if i >= 0 && i < len(r.done) {
                r.done[i] = true
        }
        r.t.Transferred += n
        r.speed.add(n)
        r.t.SpeedBps = r.speed.bps()
        if r.t.SpeedBps > 0 && r.t.Transferred < r.t.Size {
                r.t.ETASeconds = (r.t.Size - r.t.Transferred) / r.t.SpeedBps
        } else {
                r.t.ETASeconds = 0
        }
        r.t.ChunksDone = store.BitmapFromBools(r.done)
        r.t.ProgressPct = progressPct(r.t)
        r.m.markDirty(r.t)
        r.m.bus.ThrottledEmit("progress:"+r.t.ID, "TRANSFER_PROGRESS", "INFO",
                fmt.Sprintf("%s %s — %d%%", directionVerb(r.t.Direction), r.t.RelPath, r.t.ProgressPct),
                125*time.Millisecond,
                map[string]any{"transferId": r.t.ID, "path": r.t.RelPath, "pct": r.t.ProgressPct,
                        "transferred": r.t.Transferred, "size": r.t.Size})
        r.m.notify(r.t)
}

func progressPct(t *Transfer) int {
        if t.Size <= 0 {
                if t.Status == StatusCompleted {
                        return 100
                }
                return 0
        }
        p := int(float64(t.Transferred) / float64(t.Size) * 100)
        if p > 100 {
                p = 100
        }
        if p == 100 && t.Status != StatusCompleted {
                p = 99 // verification still pending
        }
        return p
}

// SetStatus lets the executor surface VERIFYING.
func (r *Runner) SetStatus(s string) {
        r.mu.Lock()
        r.t.Status = s
        r.mu.Unlock()
        r.m.notify(r.t)
        r.m.markDirty(r.t)
}

// Fail sets an error message without terminal state (executor decides).
func (r *Runner) SetError(msg string) {
        r.mu.Lock()
        r.t.Error = msg
        r.mu.Unlock()
}

// ---- control actions ----

func (m *Manager) flagsFor(id string) *flagSet {
        m.mu.Lock()
        defer m.mu.Unlock()
        f, ok := m.flags[id]
        if !ok {
                f = &flagSet{}
                m.flags[id] = f
        }
        return f
}

func (m *Manager) getLive(id string) (*Transfer, string, bool) {
        m.mu.Lock()
        defer m.mu.Unlock()
        for _, t := range m.active {
                if t.ID == id {
                        return t, "active", true
                }
        }
        for _, t := range m.queue {
                if t.ID == id {
                        return t, "queued", true
                }
        }
        return nil, "", false
}

// Pause asks an active/queued transfer to stop; it stays resumable.
func (m *Manager) Pause(id string) error {
        t, where, ok := m.getLive(id)
        if ok {
                if where == "queued" {
                        m.removeQueued(id)
                        t.Status = StatusPaused
                        m.persistNow(t)
                        m.notify(t)
                        return nil
                }
                switch t.Status {
                case StatusTransferring, StatusPreparing, StatusVerifying:
                default:
                        return fmt.Errorf("cannot pause transfer in state %s", t.Status)
                }
                f := m.flagsFor(id)
                f.mu.Lock()
                f.pauseReq = true
                f.mu.Unlock()
                return nil
        }
        return m.pausePersisted(id)
}

func (m *Manager) pausePersisted(id string) error {
        pt, found, err := m.db.GetTransfer(id)
        if err != nil || !found {
                return fmt.Errorf("transfer %s not found", id)
        }
        switch pt.Status {
        case StatusQueued, StatusPreparing, StatusTransferring, StatusVerifying:
        default:
                return fmt.Errorf("cannot pause transfer in state %s", pt.Status)
        }
        pt.Status = StatusPaused
        return m.persistTransfer(pt)
}

func (m *Manager) removeQueued(id string) {
        m.mu.Lock()
        defer m.mu.Unlock()
        for i, t := range m.queue {
                if t.ID == id {
                        m.queue = append(m.queue[:i], m.queue[i+1:]...)
                        return
                }
        }
}

// Resume re-queues a paused transfer from its persisted chunk bitmap.
func (m *Manager) Resume(id string) error {
        if _, _, ok := m.getLive(id); ok {
                return fmt.Errorf("transfer is already running")
        }
        pt, found, err := m.db.GetTransfer(id)
        if err != nil || !found {
                return fmt.Errorf("transfer %s not found", id)
        }
        if pt.Status != StatusPaused {
                return fmt.Errorf("transfer not paused")
        }
        pt.Status = StatusQueued
        pt.Error = ""
        if err := m.persistTransfer(pt); err != nil {
                return err
        }
        m.requeue(pt)
        m.bus.Emit("TRANSFER_RESUMED", "INFO", fmt.Sprintf("Resumed %s", pt.RelPath), map[string]any{"transferId": id})
        return nil
}

func (m *Manager) requeue(pt store.Transfer) {
        live := &Transfer{Transfer: pt}
        m.mu.Lock()
        m.queue = append(m.queue, live)
        m.flags[pt.ID] = &flagSet{}
        m.mu.Unlock()
        m.notify(live)
        m.dispatch()
}

// Cancel aborts a queued/active/paused transfer.
func (m *Manager) Cancel(id string) error {
        t, where, ok := m.getLive(id)
        if ok {
                if t.Status == StatusCompleted {
                        return fmt.Errorf("transfer already completed")
                }
                if where == "queued" {
                        m.removeQueued(id)
                        t.Status = StatusCancelled
                        t.CompletedAt = time.Now().Unix()
                        m.persistNow(t)
                        m.notify(t)
                        return nil
                }
                f := m.flagsFor(id)
                f.mu.Lock()
                f.cancel = true
                f.mu.Unlock()
                return nil
        }
        pt, found, err := m.db.GetTransfer(id)
        if err != nil || !found {
                return fmt.Errorf("transfer %s not found", id)
        }
        if pt.Status == StatusCompleted {
                return fmt.Errorf("transfer already completed")
        }
        pt.Status = StatusCancelled
        pt.CompletedAt = time.Now().Unix()
        if err := m.persistTransfer(pt); err != nil {
                return err
        }
        m.notify(&Transfer{Transfer: pt})
        return nil
}

// Retry re-queues a failed/cancelled transfer keeping its chunk bitmap.
func (m *Manager) Retry(id string) error {
        if _, _, ok := m.getLive(id); ok {
                return fmt.Errorf("transfer is running")
        }
        pt, found, err := m.db.GetTransfer(id)
        if err != nil || !found {
                return fmt.Errorf("transfer %s not found", id)
        }
        switch pt.Status {
        case StatusFailed, StatusCancelled:
        default:
                return fmt.Errorf("cannot retry transfer in state %s", pt.Status)
        }
        pt.Status = StatusQueued
        pt.Error = ""
        pt.CompletedAt = 0
        if err := m.persistTransfer(pt); err != nil {
                return err
        }
        m.requeue(pt)
        return nil
}

// Live returns the merged view: live transfers first, then DB rows, newest
// first.
func (m *Manager) Live(limit int, statusFilter string) []Transfer {
        m.mu.Lock()
        var out []Transfer
        seen := map[string]bool{}
        for _, t := range m.active {
                if matchStatus(t.Status, statusFilter) && !seen[t.ID] {
                        out = append(out, *t)
                        seen[t.ID] = true
                }
        }
        for _, t := range m.queue {
                if matchStatus(t.Status, statusFilter) && !seen[t.ID] {
                        out = append(out, *t)
                        seen[t.ID] = true
                }
        }
        m.mu.Unlock()
        rows, err := m.db.ListTransfers(limit, "ALL")
        if err == nil {
                for _, r := range rows {
                        if seen[r.ID] {
                                continue
                        }
                        if matchStatus(r.Status, statusFilter) {
                                out = append(out, viewOf(r))
                                seen[r.ID] = true
                        }
                }
        }
        for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
                out[i], out[j] = out[j], out[i]
        }
        if limit > 0 && len(out) > limit {
                out = out[:limit]
        }
        return out
}

func matchStatus(got, filter string) bool {
        return filter == "" || filter == "ALL" || got == filter
}

// Get returns one transfer by id.
func (m *Manager) Get(id string) (Transfer, bool, error) {
        if t, _, ok := m.getLive(id); ok {
                return *t, true, nil
        }
        pt, found, err := m.db.GetTransfer(id)
        if err != nil || !found {
                return Transfer{}, false, err
        }
        return viewOf(pt), true, nil
}

// viewOf wraps a persisted transfer for the API, deriving the progress
// percentage from the durable transferred/size counters so completed
// history never reports a stale 0%.
func viewOf(pt store.Transfer) Transfer {
        v := Transfer{Transfer: pt}
        v.ProgressPct = progressPct(&v)
        return v
}

// Chunks returns the chunk completion states for a transfer.
func (m *Manager) Chunks(id string) ([]bool, int, bool) {
        if t, _, ok := m.getLive(id); ok {
                return store.BoolsFromBitmap(t.ChunksDone, t.ChunksTotal), t.ChunksTotal, true
        }
        pt, found, err := m.db.GetTransfer(id)
        if err != nil || !found {
                return nil, 0, false
        }
        return store.BoolsFromBitmap(pt.ChunksDone, pt.ChunksTotal), pt.ChunksTotal, true
}

// ---- persistence & notification ----

// WaitSession blocks until every transfer bound to the session reaches a
// terminal state. timeout <= 0 means wait forever. It returns false on
// timeout.
func (m *Manager) WaitSession(sessionID string, timeout time.Duration) bool {
        deadline := time.Time{}
        if timeout > 0 {
                deadline = time.Now().Add(timeout)
        }
        for {
                m.mu.Lock()
                pending := 0
                for _, t := range m.active {
                        if t.SessionID == sessionID {
                                pending++
                        }
                }
                for _, t := range m.queue {
                        if t.SessionID == sessionID {
                                pending++
                        }
                }
                m.mu.Unlock()
                if pending == 0 {
                        return true
                }
                if !deadline.IsZero() && time.Now().After(deadline) {
                        return false
                }
                time.Sleep(100 * time.Millisecond)
        }
}

// SessionStats aggregates terminal transfers of one session.
type SessionStats struct {
        Bytes    int64
        Files    int
        Failures int
}

func (m *Manager) SessionStats(sessionID string) SessionStats {
        var st SessionStats
        for _, t := range m.Live(0, "ALL") {
                if t.SessionID != sessionID {
                        continue
                }
                switch t.Status {
                case StatusCompleted:
                        st.Files++
                        st.Bytes += t.Transferred
                case StatusFailed:
                        st.Failures++
                }
        }
        return st
}

func (m *Manager) notify(t *Transfer) {
        m.mu.Lock()
        subs := make([]func(*Transfer), len(m.stateSub))
        copy(subs, m.stateSub)
        m.mu.Unlock()
        for _, fn := range subs {
                fn(t)
        }
}

func (m *Manager) markDirty(t *Transfer) {
        m.persistMu.Lock()
        m.dirty[t.ID] = true
        m.persistMu.Unlock()
}

func (m *Manager) flushDirty() {
        m.persistMu.Lock()
        ids := make([]string, 0, len(m.dirty))
        for id := range m.dirty {
                ids = append(ids, id)
        }
        m.dirty = map[string]bool{}
        m.persistMu.Unlock()
        for _, id := range ids {
                if t, _, ok := m.getLive(id); ok {
                        m.persistTransfer(t.Transfer)
                }
        }
}

func (m *Manager) persistNow(t *Transfer) {
        m.persistTransfer(t.Transfer)
        m.persistMu.Lock()
        delete(m.dirty, t.ID)
        m.persistMu.Unlock()
}

func (m *Manager) persistTransfer(t store.Transfer) error {
        return m.db.PutTransfer(t)
}

func humanBytes(n int64) string {
        const unit = 1024
        if n < unit {
                return fmt.Sprintf("%d B", n)
        }
        div, exp := int64(unit), 0
        for mm := n / unit; mm >= unit; mm /= unit {
                div *= unit
                exp++
        }
        return fmt.Sprintf("%.1f %ciB", float64(n)/float64(div), "KMGTPE"[exp])
}
