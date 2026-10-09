// Package native manages the optional C++ hashing worker
// (meshsync-native). The worker speaks a JSON-lines protocol on
// stdin/stdout: one request object per line, one response object per line.
// Large files are routed through the worker; when the binary is missing or
// fails, the agent falls back to pure-Go hashing and records a
// NATIVE_FALLBACK event once.
package native

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os/exec"
	"sync"
	"time"

	"github.com/ParsaFathii/MeshSync/agent/internal/events"
)

type request struct {
	Op     string `json:"op"`
	Path   string `json:"path,omitempty"`
	Offset int64  `json:"offset,omitempty"`
	Length int64  `json:"length,omitempty"`
}

type response struct {
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
	Hash  string `json:"hash,omitempty"`
	Bytes int64  `json:"bytes,omitempty"`
	Ms    int64  `json:"ms,omitempty"`
}

type Worker struct {
	mu     sync.Mutex
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout *bufio.Reader
	alive  bool

	path    string
	bus     *events.Bus
	warned  bool
	Version string
}

// Start launches the worker binary. A nil path or failed start simply
// leaves the worker inactive.
func Start(binary string, bus *events.Bus) *Worker {
	w := &Worker{path: binary, bus: bus}
	if binary == "" {
		return w
	}
	if err := w.spawn(); err != nil {
		w.recordFallback("worker start failed: " + err.Error())
	} else {
		w.Version = "cpp-worker-1.0.0"
	}
	return w
}

func (w *Worker) spawn() error {
	cmd := exec.Command(w.path)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("spawn %s: %w", w.path, err)
	}
	// drain stderr so the worker never blocks on error output
	go func() {
		buf := make([]byte, 4096)
		for {
			if _, err := stderr.Read(buf); err != nil {
				return
			}
		}
	}()
	w.cmd = cmd
	w.stdin = stdin
	w.stdout = bufio.NewReaderSize(stdout, 64*1024)
	w.alive = true
	return nil
}

func (w *Worker) recordFallback(reason string) {
	if w.warned {
		return
	}
	w.warned = true
	if w.bus != nil {
		w.bus.Emit("NATIVE_FALLBACK", "WARN",
			"Native hashing engine unavailable; using Go fallback ("+reason+")", nil)
	}
}

// Available reports whether the worker process is running.
func (w *Worker) Available() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.alive
}

// HashFile delegates a whole-file SHA-256 to the worker when possible.
func (w *Worker) HashFile(path string) (string, int64, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if !w.alive {
		return "", 0, fmt.Errorf("worker not running")
	}
	resp, err := w.roundtrip(request{Op: "hash", Path: path})
	if err != nil {
		w.alive = false
		w.recordFallback("worker communication failed: " + err.Error())
		return "", 0, err
	}
	if !resp.OK {
		return "", 0, fmt.Errorf("native error: %s", resp.Error)
	}
	return resp.Hash, resp.Bytes, nil
}

func (w *Worker) roundtrip(req request) (*response, error) {
	raw, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	if _, err := w.stdin.Write(append(raw, '\n')); err != nil {
		return nil, err
	}
	line, err := w.stdout.ReadBytes('\n')
	if err != nil {
		return nil, err
	}
	var resp response
	if err := json.Unmarshal(line, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// Stop asks the worker to quit and waits briefly.
func (w *Worker) Stop() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if !w.alive {
		return
	}
	_, _ = w.stdin.Write([]byte(`{"op":"quit"}` + "\n"))
	done := make(chan struct{})
	go func() { _, _ = w.cmd.Process.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		_ = w.cmd.Process.Kill()
	}
	w.alive = false
}

// HashGo is the pure-Go streaming SHA-256 used as fallback and for small
// files. It reads in 1 MiB buffers so huge files never load fully into
// memory.
func HashGo(path string) (string, int64, error) {
	f, err := openForRead(path)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()
	h := sha256.New()
	n, err := io.CopyBuffer(h, f, make([]byte, 1024*1024))
	if err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(h.Sum(nil)), n, nil
}

// HashChunkGo hashes a byte range of a file (used for chunk verification).
func HashChunkGo(path string, offset, length int64) (string, error) {
	f, err := openForRead(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	if _, err := f.Seek(offset, io.SeekStart); err != nil {
		return "", err
	}
	h := sha256.New()
	if _, err := io.CopyN(h, f, length); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
