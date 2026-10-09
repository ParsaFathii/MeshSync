// Package sync computes synchronization plans and executes them. The
// planner classifies every path in the union of the local index and the
// remote manifest using content hashes only — never timestamps. The
// resulting plan is inspectable before anything runs.
package sync

import (
        "sort"

        "github.com/ParsaFathii/MeshSync/agent/internal/netproto"
        "github.com/ParsaFathii/MeshSync/agent/internal/store"
)

// Action states (as exposed by the API).
const (
        StUnchanged      = "UNCHANGED"
        StLocalOnly      = "LOCAL_ONLY"
        StRemoteOnly     = "REMOTE_ONLY"
        StLocalModified  = "LOCAL_MODIFIED"
        StRemoteModified = "REMOTE_MODIFIED"
        StConflict       = "CONFLICT"
        StDeleteLocal    = "DELETE_LOCAL"
        StDeleteRemote   = "DELETE_REMOTE"
)

// Action is one planned step for one relative path.
type Action struct {
        RelPath        string `json:"relPath"`
        State          string `json:"state"`
        Direction      string `json:"direction"` // PUSH | PULL | NONE
        Size           int64  `json:"size"`
        LocalHash      string `json:"localHash"`
        RemoteHash     string `json:"remoteHash"`
        LastSyncedHash string `json:"lastSyncedHash"`
        // RemoteSize/RemoteMtime describe the peer's version when one exists
        // (0 when the remote never had the file or deleted it). They are what
        // conflict records must store, never Size (which is the local size).
        RemoteSize  int64 `json:"remoteSize"`
        RemoteMtime int64 `json:"remoteMtime"`
}

// Plan is the full classification for one folder against one peer.
type Plan struct {
        Folder      string   `json:"folder"`
        GeneratedAt int64    `json:"generatedAt"`
        Actions     []Action `json:"actions"`
        Summary     Summary  `json:"summary"`
}

// Summary counts by action state.
type Summary struct {
        Total        int `json:"total"`
        Pull         int `json:"pull"`
        Push         int `json:"push"`
        DeleteLocal  int `json:"deleteLocal"`
        DeleteRemote int `json:"deleteRemote"`
        Conflicts    int `json:"conflicts"`
        Unchanged    int `json:"unchanged"`
}

// Plan computes the synchronization plan. local entries come from the file
// index, remote entries from the peer's manifest. Both must belong to the
// same folder name.
func ComputePlan(folderName string, local []store.FileEntry, remote []netproto.ManifestEntry, now int64) *Plan {
        p := &Plan{Folder: folderName, GeneratedAt: now}
        rem := map[string]netproto.ManifestEntry{}
        for _, r := range remote {
                rem[r.Path] = r
        }
        seen := map[string]bool{}

        for _, l := range local {
                seen[l.RelPath] = true
                r, hasRemote := rem[l.RelPath]
                s := l.LastSyncedHash
                switch {
                case l.Deleted && (!hasRemote || r.Deleted):
                        // both gone (or remote never knew it): nothing to do
                        p.add(Action{RelPath: l.RelPath, State: StUnchanged, Direction: "NONE", LastSyncedHash: s})
                case l.Deleted && hasRemote && !r.Deleted:
                        if r.Hash == s && s != "" {
                                p.add(Action{RelPath: l.RelPath, State: StDeleteRemote, Direction: "NONE", LocalHash: "", RemoteHash: r.Hash, Size: r.Size, RemoteSize: r.Size, RemoteMtime: r.Mtime, LastSyncedHash: s})
                        } else {
                                p.add(Action{RelPath: l.RelPath, State: StConflict, Direction: "NONE", LocalHash: "", RemoteHash: r.Hash, Size: r.Size, RemoteSize: r.Size, RemoteMtime: r.Mtime, LastSyncedHash: s})
                        }
                case !l.Deleted && hasRemote && r.Deleted:
                        if l.Hash == s && s != "" {
                                p.add(Action{RelPath: l.RelPath, State: StDeleteLocal, Direction: "NONE", LocalHash: l.Hash, RemoteHash: "", Size: l.Size, LastSyncedHash: s})
                        } else {
                                p.add(Action{RelPath: l.RelPath, State: StConflict, Direction: "NONE", LocalHash: l.Hash, RemoteHash: "", Size: l.Size, LastSyncedHash: s})
                        }
                case !l.Deleted && hasRemote && !r.Deleted:
                        switch {
                        case l.Hash == r.Hash:
                                p.add(Action{RelPath: l.RelPath, State: StUnchanged, Direction: "NONE", Size: l.Size, LocalHash: l.Hash, RemoteHash: r.Hash, RemoteSize: r.Size, RemoteMtime: r.Mtime, LastSyncedHash: s})
                        case s != "" && l.Hash == s:
                                p.add(Action{RelPath: l.RelPath, State: StRemoteModified, Direction: "PULL", Size: r.Size, LocalHash: l.Hash, RemoteHash: r.Hash, RemoteSize: r.Size, RemoteMtime: r.Mtime, LastSyncedHash: s})
                        case s != "" && r.Hash == s:
                                p.add(Action{RelPath: l.RelPath, State: StLocalModified, Direction: "PUSH", Size: l.Size, LocalHash: l.Hash, RemoteHash: r.Hash, RemoteSize: r.Size, RemoteMtime: r.Mtime, LastSyncedHash: s})
                        default:
                                p.add(Action{RelPath: l.RelPath, State: StConflict, Direction: "NONE", Size: l.Size, LocalHash: l.Hash, RemoteHash: r.Hash, RemoteSize: r.Size, RemoteMtime: r.Mtime, LastSyncedHash: s})
                        }
                default: // local exists, remote never saw it
                        state := StLocalOnly
                        if s != "" {
                                // we synced this before but the remote lost all knowledge
                                // (fresh database): treat as push so it heals
                                state = StLocalModified
                        }
                        p.add(Action{RelPath: l.RelPath, State: state, Direction: "PUSH", Size: l.Size, LocalHash: l.Hash, LastSyncedHash: s})
                }
        }

        for path, r := range rem {
                if seen[path] {
                        continue
                }
                if r.Deleted {
                        // remote tombstone for a file we never had: nothing to do
                        continue
                }
                p.add(Action{RelPath: path, State: StRemoteOnly, Direction: "PULL", Size: r.Size, RemoteHash: r.Hash, RemoteSize: r.Size, RemoteMtime: r.Mtime})
        }

        sort.Slice(p.Actions, func(i, j int) bool { return p.Actions[i].RelPath < p.Actions[j].RelPath })
        return p
}

func (p *Plan) add(a Action) {
        p.Actions = append(p.Actions, a)
        switch a.State {
        case StUnchanged:
                p.Summary.Unchanged++
        case StDeleteLocal:
                p.Summary.DeleteLocal++
        case StDeleteRemote:
                p.Summary.DeleteRemote++
        case StConflict:
                p.Summary.Conflicts++
        default:
                if a.Direction == "PULL" {
                        p.Summary.Pull++
                } else if a.Direction == "PUSH" {
                        p.Summary.Push++
                }
        }
        p.Summary.Total++
}
