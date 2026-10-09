// Package indexer walks shared folders, computes content hashes, and keeps
// the local file index in sync with the real filesystem. It also watches
// for live changes (fsnotify) so edits made outside MeshSync are picked up
// while the agent runs.
package indexer

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/fsnotify/fsnotify"

	"github.com/ParsaFathii/MeshSync/agent/internal/events"
	"github.com/ParsaFathii/MeshSync/agent/internal/native"
	"github.com/ParsaFathii/MeshSync/agent/internal/store"
)

// SetSkipHidden toggles hidden-file skipping live.
func (ix *Indexer) SetSkipHidden(skip bool) { ix.skipDot.Store(skip) }

const (
	// stateDirName is the reserved directory inside every shared folder.
	stateDirName = ".meshsync"
	// mtimeSameWindow: local re-index skips re-hashing when size and mtime
	// (millisecond precision) are unchanged. Remote comparisons ALWAYS use
	// content hashes; mtime is only a local scan optimization.
	mtimeSameWindow = int64(1500) // ms
)

type Indexer struct {
	db      *store.DB
	bus     *events.Bus
	worker  *native.Worker
	skipDot atomic.Bool

	wmu      sync.Mutex
	watcher  *fsnotify.Watcher
	watching map[string]bool // folder roots currently watched

	pendMu sync.Mutex
	pend   map[string]time.Time // folderID/relPath -> last debounce stamp
}

func New(db *store.DB, bus *events.Bus, worker *native.Worker, skipHidden bool) *Indexer {
	ix := &Indexer{
		db:       db,
		bus:      bus,
		worker:   worker,
		watching: map[string]bool{},
		pend:     map[string]time.Time{},
	}
	ix.skipDot.Store(skipHidden)
	return ix
}

// SafeJoin resolves relPath inside root and guarantees the result stays
// inside root. It rejects absolute paths, ".." segments, empty segments,
// backslashes and NUL bytes — every remote path passes through this before
// any filesystem write.
func SafeJoin(root, relPath string) (string, error) {
	if relPath == "" {
		return "", fmt.Errorf("empty relative path")
	}
	if strings.ContainsRune(relPath, 0) {
		return "", fmt.Errorf("NUL byte in path")
	}
	if strings.ContainsRune(relPath, '\\') {
		return "", fmt.Errorf("backslash in path")
	}
	clean := filepath.Clean("/" + relPath) // forces ".." resolution against root
	clean = strings.TrimPrefix(clean, "/")
	if clean == "" || clean == "." || clean == stateDirName || clean == ".." ||
		strings.HasPrefix(clean, "../") || clean == "/" {
		return "", fmt.Errorf("unsafe path %q", relPath)
	}
	for _, seg := range strings.Split(clean, "/") {
		if seg == ".." {
			return "", fmt.Errorf("unsafe path %q", relPath)
		}
	}
	joined := filepath.Join(root, filepath.FromSlash(clean))
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	joinedAbs, err := filepath.Abs(joined)
	if err != nil {
		return "", err
	}
	if joinedAbs != rootAbs && !strings.HasPrefix(joinedAbs, rootAbs+string(os.PathSeparator)) {
		return "", fmt.Errorf("path escapes folder root")
	}
	return joinedAbs, nil
}

// hashFile routes to the C++ worker for large files when available, and to
// Go otherwise.
func (ix *Indexer) hashFile(abs string, size int64) (string, error) {
	if ix.worker != nil && ix.worker.Available() && size >= 1024*1024 {
		if h, _, err := ix.worker.HashFile(abs); err == nil {
			return h, nil
		}
	}
	h, _, err := native.HashGo(abs)
	return h, err
}

// IndexFile (re)indexes a single file and updates the store. Returns the
// computed hash. A missing file becomes a tombstone.
func (ix *Indexer) IndexFile(folder store.Folder, relPath string) (store.FileEntry, error) {
	abs, err := SafeJoin(folder.Path, relPath)
	if err != nil {
		return store.FileEntry{}, err
	}
	prev, hadPrev, err := ix.db.GetFile(folder.ID, relPath)
	if err != nil {
		return store.FileEntry{}, err
	}
	st, err := os.Stat(abs)
	if err != nil {
		if os.IsNotExist(err) && hadPrev {
			// File vanished: tombstone (keeps lastSyncedHash so deletion
			// can be propagated safely).
			tomb := store.FileEntry{
				FolderID: folder.ID, RelPath: relPath,
				Size: 0, Mtime: 0, Hash: "",
				LastSyncedHash: prev.LastSyncedHash,
				Deleted:        true, UpdatedAt: nowUnix(),
			}
			return tomb, ix.db.PutFile(tomb)
		}
		return store.FileEntry{}, err
	}
	if !st.Mode().IsRegular() {
		// symlinks/specials: never hashed, never synced (documented policy)
		return store.FileEntry{}, fmt.Errorf("not a regular file")
	}
	mtimeMs := st.ModTime().UnixMilli()
	if hadPrev && !prev.Deleted && prev.Size == st.Size() && absDiff(prev.Mtime, mtimeMs) <= mtimeSameWindow && prev.Hash != "" {
		// unchanged since last index: keep the existing hash
		return prev, nil
	}
	hash, err := ix.hashFile(abs, st.Size())
	if err != nil {
		return store.FileEntry{}, err
	}
	entry := store.FileEntry{
		FolderID: folder.ID, RelPath: relPath,
		Size: st.Size(), Mtime: mtimeMs, Hash: hash,
		LastSyncedHash: prev.LastSyncedHash,
		Deleted:        false, UpdatedAt: nowUnix(),
	}
	if err := ix.db.PutFile(entry); err != nil {
		return entry, err
	}
	changed := !hadPrev || prev.Hash != hash || prev.Deleted
	if changed && ix.bus != nil {
		if !hadPrev {
			ix.bus.Emit("FILE_INDEXED", "INFO", fmt.Sprintf("Indexed %s/%s (%s)", folder.Name, relPath, humanBytes(st.Size())), map[string]any{"folder": folder.Name, "path": relPath})
		} else {
			ix.bus.Emit("FILE_CHANGED", "INFO", fmt.Sprintf("Changed %s/%s", folder.Name, relPath), map[string]any{"folder": folder.Name, "path": relPath})
		}
	}
	return entry, nil
}

// Rescan walks the whole folder, hashes what changed, and tombstones what
// disappeared. It is safe to run at any time.
func (ix *Indexer) Rescan(folder store.Folder) (scanned, changed, removed int, err error) {
	type diskEntry struct {
		rel  string
		size int64
		mt   int64
	}
	disk := map[string]diskEntry{}
	err = filepath.WalkDir(folder.Path, func(p string, de fs.DirEntry, err error) error {
		if err != nil {
			// unreadable entries are skipped, never fatal
			return nil
		}
		rel, rerr := filepath.Rel(folder.Path, p)
		if rerr != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		if rel == "." {
			return nil
		}
		base := filepath.Base(p)
		if ix.skipDot.Load() && strings.HasPrefix(base, ".") && base != stateDirName {
			if de.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if base == stateDirName {
			if de.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if de.IsDir() {
			return nil
		}
		info, ierr := de.Info()
		if ierr != nil || !info.Mode().IsRegular() {
			return nil
		}
		disk[rel] = diskEntry{rel: rel, size: info.Size(), mt: info.ModTime().UnixMilli()}
		return nil
	})
	if err != nil {
		return
	}
	indexed, err := ix.db.ListFiles(folder.ID)
	if err != nil {
		return
	}
	prev := map[string]store.FileEntry{}
	for _, e := range indexed {
		prev[e.RelPath] = e
	}
	scanned = len(disk)
	for rel, de := range disk {
		p, had := prev[rel]
		if had && !p.Deleted && p.Size == de.size && absDiff(p.Mtime, de.mt) <= mtimeSameWindow && p.Hash != "" {
			continue // unchanged, hash retained
		}
		if _, err := ix.IndexFile(folder, rel); err == nil {
			changed++
		}
	}
	for rel, p := range prev {
		if _, still := disk[rel]; !still && !p.Deleted {
			tomb := store.FileEntry{
				FolderID: folder.ID, RelPath: rel, Size: 0, Mtime: 0, Hash: "",
				LastSyncedHash: p.LastSyncedHash, Deleted: true, UpdatedAt: nowUnix(),
			}
			if err := ix.db.PutFile(tomb); err == nil {
				removed++
				if ix.bus != nil {
					ix.bus.Emit("FILE_DELETED", "INFO", fmt.Sprintf("Removed %s/%s", folder.Name, rel), map[string]any{"folder": folder.Name, "path": rel})
				}
			}
		}
	}
	return
}

// ScanTree lists one directory level for the file browser, from real disk.
type Listing struct {
	Name  string
	Dir   bool
	Size  int64
	Mtime int64
	Hash  string
}

func (ix *Indexer) ListDir(folder store.Folder, relDir string) ([]Listing, error) {
	absDir := folder.Path
	if relDir != "" {
		var err error
		absDir, err = SafeJoin(folder.Path, relDir)
		if err != nil {
			return nil, err
		}
	}
	entries, err := os.ReadDir(absDir)
	if err != nil {
		return nil, err
	}
	out := []Listing{}
	for _, de := range entries {
		name := de.Name()
		if name == stateDirName {
			continue
		}
		if ix.skipDot.Load() && strings.HasPrefix(name, ".") {
			continue
		}
		rel := name
		if relDir != "" {
			rel = relDir + "/" + name
		}
		l := Listing{Name: name}
		info, err := de.Info()
		if err != nil {
			continue
		}
		l.Size = info.Size()
		l.Mtime = info.ModTime().UnixMilli()
		if de.IsDir() {
			if !isSymlink(info.Mode()) {
				l.Dir = true
				out = append(out, l)
			}
			continue
		}
		if !info.Mode().IsRegular() { // symlink/special: visible but flagged via empty hash
			continue
		}
		// hash from index when fresh
		if fe, ok, _ := ix.db.GetFile(folder.ID, rel); ok && !fe.Deleted && fe.Size == l.Size && absDiff(fe.Mtime, l.Mtime) <= mtimeSameWindow {
			l.Hash = fe.Hash
		}
		out = append(out, l)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Dir != out[j].Dir {
			return out[i].Dir
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out, nil
}

func isSymlink(m fs.FileMode) bool { return m&fs.ModeSymlink != 0 }

// ---- live watching ----

// StartWatching adds a folder root to the fsnotify watcher.
func (ix *Indexer) StartWatching(folder store.Folder) error {
	if ix.watcher == nil {
		w, err := fsnotify.NewWatcher()
		if err != nil {
			return err
		}
		ix.watcher = w
		go ix.watchLoop()
	}
	ix.wmu.Lock()
	defer ix.wmu.Unlock()
	if ix.watching[folder.Path] {
		return nil
	}
	if err := addWatchRecursive(ix.watcher, folder.Path); err != nil {
		return err
	}
	ix.watching[folder.Path] = true
	return nil
}

func addWatchRecursive(w *fsnotify.Watcher, root string) error {
	return filepath.WalkDir(root, func(p string, de fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if !de.IsDir() {
			return nil
		}
		if filepath.Base(p) == stateDirName {
			return fs.SkipDir
		}
		return w.Add(p)
	})
}

func (ix *Indexer) watchLoop() {
	for {
		select {
		case ev, ok := <-ix.watcher.Events:
			if !ok {
				return
			}
			ix.handleWatchEvent(ev)
		case _, ok := <-ix.watcher.Errors:
			if !ok {
				return
			}
		}
	}
}

// debounce window for watch-triggered reindex
const debounce = 400 * time.Millisecond

func (ix *Indexer) handleWatchEvent(ev fsnotify.Event) {
	// Find owning folder root.
	folders, err := ix.db.ListFolders()
	if err != nil {
		return
	}
	var folder *store.Folder
	var rel string
	for i := range folders {
		if folders[i].Path != "" && (ev.Name == folders[i].Path || strings.HasPrefix(ev.Name, folders[i].Path+string(os.PathSeparator))) {
			folder = &folders[i]
			r, err := filepath.Rel(folder.Path, ev.Name)
			if err != nil {
				return
			}
			rel = filepath.ToSlash(r)
			break
		}
	}
	if folder == nil || rel == "." || rel == "" {
		return
	}
	if strings.HasPrefix(filepath.Base(ev.Name), ".meshsync") {
		return
	}
	if ix.skipDot.Load() && strings.HasPrefix(filepath.Base(ev.Name), ".") {
		return
	}
	ix.pendMu.Lock()
	ix.pend[folder.Path+"/"+rel] = time.Now()
	ix.pendMu.Unlock()
	time.AfterFunc(debounce, func() { ix.flushPending(folder, rel) })
}

func (ix *Indexer) flushPending(folder *store.Folder, rel string) {
	time.Sleep(50 * time.Millisecond) // small settle for writer closes
	ix.pendMu.Lock()
	delete(ix.pend, folder.Path+"/"+rel)
	ix.pendMu.Unlock()
	st, err := os.Stat(evPath(folder.Path, rel))
	if err != nil {
		// vanished -> tombstone via IndexFile
		_, _ = ix.IndexFile(*folder, rel)
		return
	}
	if st.IsDir() {
		// new directory: watch + index its files
		_ = addWatchRecursive(ix.watcher, evPath(folder.Path, rel))
		return
	}
	if !st.Mode().IsRegular() {
		return
	}
	_, _ = ix.IndexFile(*folder, rel)
}

func evPath(root, rel string) string { return filepath.Join(root, filepath.FromSlash(rel)) }

func nowUnix() int64 { return time.Now().Unix() }

func absDiff(a, b int64) int64 {
	if a > b {
		return a - b
	}
	return b - a
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
