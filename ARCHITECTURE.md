# MeshSync Architecture

Layered view: clients (Flutter, web console, curl) talk only to their local
agent's HTTP/WebSocket API; the Go agent owns all state (SQLite + filesystem),
does the synchronization work with an optional C++ native hashing worker, and
talks to peer agents over TLS 1.3. There is no server component and no cloud.

Overview diagram: [docs/assets/architecture.svg](docs/assets/architecture.svg).

```
┌────────────────────────────────────────────────────────────────────┐
│ clients: Flutter app · web console (Next.js) · curl/scripts        │
└──────────────┬─────────────────────────────────────────────────────┘
               │ HTTP + WebSocket, 127.0.0.1:3040 (default)
┌──────────────▼─────────────────────────────────────────────────────┐
│ meshsync-agent (Go)                                                │
│  api/      REST v1 + WS events, token auth, rate limiting          │
│  app/      wiring, pairing, discovery, peer monitor, handlers      │
│  sync/     planner (8 states) + engine (sessions, conflicts)       │
│  transfer/ queue, chunked executor, pause/resume, token bucket     │
│  indexer/  walk + hash + fsnotify watch, path validation           │
│  netproto/ framed wire protocol, TLS 1.3 + Ed25519 pinning         │
│  identity/ events/ config/ store/ version/                         │
│  native/   C++ worker process management (JSON-lines)              │
└──┬───────────────┬───────────────────────┬─────────────────────────┘
   │               │                       │
   ▼               ▼                       ▼
 SQLite        shared folders        peer network (TLS 1.3, TCP 4040;
 meshsync.db   + trash/ + parts/     discovery UDP 239.255.42.42:4100)
```

## Package map (`agent/internal/`)

| Package | Responsibility |
|---|---|
| `cmd/meshsync-agent` | flag parsing, wiring, startup order (`main.go`) |
| `config` | `config.json` + env overrides + flags; validation and live apply |
| `identity` | persistent Ed25519 identity; peer ID = first 16 hex chars of SHA-256(pubkey) |
| `netproto` | wire protocol: 5-byte-length frames, 23 message types, TLS configs, dial/serve loops |
| `store` | SQLite access layer + schema (`store/migrations/001_init.sql`), chunk bitmaps |
| `indexer` | directory walks, hashing dispatch, fsnotify watching, `SafeJoin` path validation |
| `sync` | plan computation (`planner.go`) and execution (`engine.go`): sessions, conflicts, trash |
| `transfer` | transfer queue + worker pool (`manager.go`), global token bucket (`bandwidth.go`) |
| `events` | event bus: persistence, subscriber fan-out, throttled emits |
| `native` | C++ worker process lifecycle; pure-Go hashing fallback |
| `api` | HTTP mux, middleware (CORS/auth/rate limit), WS upgrader and pump |
| `app` | composition root; implements the peer-side protocol handlers |

Other components: `native/cpp` (C++20 hashing worker), `src/` (web console),
`flutter/` (Flutter client), `docs/` (this documentation),
`deploy/` (Docker packaging), `scripts/` (release tooling).

## Schema (SQLite, migration `001_init.sql`)

- `peers` — peer ID, name, address, pinned public key, trust, version/platform.
- `folders` — unique name + absolute path per shared folder.
- `files` — per (folder, rel_path): size, mtime, hash, `last_synced_hash`,
  `deleted` tombstone. Indexes on folder and tombstones.
- `transfers` — direction, sizes, `file_hash`, chunk size, `chunks_total`,
  chunk bitmap (`chunks_done`), status, error, session linkage.
- `conflicts` — both versions' hash/size/mtime, remote peer, status, resolution.
- `events` — append-only event log (ids used for `sinceEventId` polling).
- `sessions` — sync session records (status, bytes, files, error).
- `remote_manifests` — cached last-seen remote state per peer/folder/path.
- `meta` — schema metadata.

SQLite goes through `modernc.org/sqlite` — pure Go, no cgo, so the agent
cross-compiles trivially. Timestamps are unix seconds (UTC) at the storage
layer and RFC 3339 at the API layer.

## Data flow

### Discovery and pairing

1. Each agent beacons `{"peerId","name","version","peerPort"}` to
   `239.255.42.42:4100` every 5 s; the listener joins the group with
   `SO_REUSEADDR` so multiple agents coexist on one host.
2. Unknown beacons are recorded as `DISCOVERED` peers (+`PEER_DISCOVERED`).
3. Pairing: `POST /peers/pair` dials the peer, learns its Ed25519 key from
   its certificate, sends `PAIR_REQUEST`; the remote records `PAIRING` and
   emits `PAIR_REQUESTED`. Approval marks `TRUSTED` and sends
   `PAIR_APPROVED` back, flipping the initiator's record too.
   State machine: [docs/assets/peer-lifecycle.svg](docs/assets/peer-lifecycle.svg).

### Indexing

- Full rescan walks the folder, skipping `.meshsync` state dirs; each file is
  hashed unless (size, mtime) is unchanged within a 1500 ms window — mtime is
  a *local scan shortcut only*; sync decisions always compare hashes.
- fsnotify watches every directory recursively; events are debounced
  (400 ms + 50 ms settle) and re-indexed individually; vanished files
  tombstone.
- Hashing dispatch: files ≥ 1 MiB go to the C++ worker when available;
  otherwise pure-Go streaming SHA-256 (1 MiB buffers). Worker failure emits
  one `NATIVE_FALLBACK` event and the agent continues in Go mode.

### Sync session

1. `POST /sync/run` (or `GET /sync/plan` for dry-run): rescan, connect,
   exchange `INDEX` manifests both ways, cache the remote manifest.
2. Planner classifies the union of paths (see README table of 8 states).
3. Control actions on the session connection: `CONFLICT_NOTIFY` (open a
   conflict on the peer), `DELETE_FILE` (hash-guarded), `ADOPT` (heal
   drifted `lastSyncedHash` without transferring).
4. PUSH/PULL actions become queued transfers; the manager runs up to
   `concurrentTransfers` in parallel, each chunk verified, part file, full
   verification, atomic rename, index update, `ADOPT` + `FILE_END`.
5. Session status (`COMPLETED`/`FAILED`) plus events; live progress via WS
   `transfer` frames (throttled ~8/s) and `TRANSFER_PROGRESS` events.
   Flow diagram: [docs/assets/sync-flow.svg](docs/assets/sync-flow.svg).

### Transfer resume

Chunk done-state is a persisted bitmap in SQLite. `pause` freezes the state
(and a restart moves interrupted transfers to `PAUSED` at startup);
`resume`/`retry` continue from the first pending chunk; the part file path is
deterministic (`sha256(folderID|peerID|relPath)`), so both an initiator and a
passive receiver derive the same location — that is what makes interrupted
transfers resumable. Diagram: [docs/assets/chunk-transfer.svg](docs/assets/chunk-transfer.svg).

## Design decisions

- **Pure-Go SQLite (`modernc.org/sqlite`).** No cgo in the agent; simpler
  cross-compilation and no system library coupling. The C++ performance work
  is isolated in the hashing worker instead.
- **C++20 native worker over JSON-lines.** Hashing large files is the
  CPU-bound hot path. The worker is a child process speaking one JSON object
  per line on stdin/stdout (`{"op":"hash","path":…}` → `{"ok":true,"hash":…}`),
  with stderr drained and a hard fallback to Go hashing
  (`NATIVE_FALLBACK`). The agent is fully functional without it — the
  worker is an optimization, not a dependency.
- **fsnotify watching.** Edits made outside MeshSync are picked up while the
  agent runs; a periodic or on-demand `rescan` covers the offline window.
  Watch events are debounced to absorb editor write patterns.
- **gorilla/websocket for events.** One upgraded connection per client, a
  `hello` frame with a device snapshot, fan-out through buffered channels
  (slow subscribers drop frames, never block the agent), client `ping` /
  server `pong` keepalive.
- **Trash before destructive ops.** Local deletions, remote deletions, and
  conflict overwrites move the losing copy to `~/.meshsync/trash/<folder>/`
  (timestamped names) before writing. Data loss requires two explicit steps.
- **Token-bucket bandwidth.** One global bucket shared by all transfers,
  applied per chunk on both send and receive sides; burst = one second of
  rate (capped at 8 MiB). Predictable without per-connection machinery.
- **Hash-only sync semantics.** mtime/size shortcuts never decide sync
  outcomes across devices; only SHA-256 content equality does. This costs
  hashing but eliminates the classic "clock skew clobbered my file" bug.
- **Plan-first execution.** `GET /sync/plan` is the same code path as
  `POST /sync/run` minus the writes, so what you inspect is what runs.

## Concurrency model

- Each peer connection is one goroutine pair (read loop on the server; the
  dialer owns its reads). Frame writes are mutex-serialized per connection.
- The transfer manager runs a dispatcher tick (250 ms) plus one goroutine per
  active transfer (bounded by `concurrentTransfers`, 1–8). Control flags
  (pause/cancel) are checked between chunks, never mid-frame.
- The indexer serializes watch-driven re-indexes behind a debounce map; the
  fsnotify loop is single-goroutine.
- The event bus emits non-blocking: subscribers have buffered channels
  (256); overflow drops the frame for that subscriber only.
- Shared mutable state is either mutex-guarded (`Agent.peersMu`,
  `Manager.mu`, `Bandwidth.mu`) or atomic (`stopped`, `skipDot`). Live
  config is an RWMutex-guarded copy — settings changes apply without restart.

## Reconnection and backoff

- **Peer monitor:** every 2 s, each `TRUSTED`/`PAIRING` peer is probed with a
  real dial + HELLO + ping round trip (5 s timeout). Failed probes back off
  linearly: 10 s, 20 s, … capped at 60 s. State transitions emit
  `PEER_ONLINE`/`PEER_OFFLINE` and a WS `peers` frame.
- **Clients:** the WS protocol documents disconnects as normal; clients
  reconnect with backoff (the web console uses 1 s → 30 s cap) and refetch
  all state over REST on reconnect. Stale WS state is never trusted.
- **Agent restart:** interrupted transfers become `PAUSED` (persisted chunk
  maps), folders are rescanned and re-watched, discovery resumes beacons.
  No re-pairing is needed — identity and trust are persisted.
