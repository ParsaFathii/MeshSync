# MeshSync

MeshSync synchronizes directories between your own devices over the local
network, peer to peer, without any cloud service in between. Each device runs
a small agent that owns a local SQLite state database, hashes file content,
talks to the other agents directly, and exposes a versioned REST + WebSocket
API on `127.0.0.1`. A web console and a Flutter client are pure consumers of
that API.

- Owner: Parsa Fathi · Copyright © 2026 Parsa Fathi
- License: Apache-2.0
- Full API contract: [docs/API.md](docs/API.md)
- 5-minute demo: [docs/QUICKSTART.md](docs/QUICKSTART.md)
- فارسی: [docs/fa/README_FA.md](docs/fa/README_FA.md)

## What it is for

Typical situations MeshSync is built for:

- Keep a working directory identical on a desktop and a laptop that sit on
  the same LAN, with no third party seeing the bytes.
- Move large files (media, VM images, datasets) between machines without
  round-tripping through an external drive or an upload.
- Keep edits flowing while offline: every device holds a complete copy of the
  folder; sync is a local decision, not a gate you must pass to keep working.
- Review changes before they happen: the sync planner produces a full
  classification of what would move, before anything moves.

Not a fit: devices that can never reach each other (MeshSync is LAN-only —
there is no relay and no NAT traversal), and multi-user sharing with
per-file ACLs (the trust model is per-device and single-user oriented).

## How it works

```
 Flutter client ──┐                         ┌── Flutter client
 Web console   ───┤ HTTP + WS :3040         ├─ HTTP + WS :3041
 curl/scripts  ───┘          │              ┘
                    meshsync-agent (Go)     meshsync-agent (Go)
                    SQLite · file index ·   SQLite · file index ·
                    C++ hashing worker      C++ hashing worker
                             │                       │
                             └── TLS 1.3 peer TCP ───┘
                                              TCP 4040 ↔ 4041
             UDP multicast discovery 239.255.42.42:4100
```

Diagrams (original SVGs, all under [docs/assets/](docs/assets/)):

| Diagram | Contents |
|---|---|
| [architecture.svg](docs/assets/architecture.svg) | layered system architecture |
| [peer-lifecycle.svg](docs/assets/peer-lifecycle.svg) | peer trust state machine |
| [sync-flow.svg](docs/assets/sync-flow.svg) | sync planning and execution |
| [chunk-transfer.svg](docs/assets/chunk-transfer.svg) | chunked transfer, hashes, resume |
| [conflict-resolution.svg](docs/assets/conflict-resolution.svg) | conflict detection and resolution |
| [release-pipeline.svg](docs/assets/release-pipeline.svg) | tag → validate → package → release |

See [ARCHITECTURE.md](ARCHITECTURE.md) for the package map, data flow, and
design decisions.

## Peer model

A *peer* is another device's agent, identified by the SHA-256 of its
persistent Ed25519 public key (first 8 bytes, hex — 16 characters). The ID is
stable across restarts and cannot be spoofed without the private key. Agents
find each other via UDP multicast beacons (`239.255.42.42:4100`, sent every
5 seconds) and connect over TCP with TLS 1.3.

Folders synchronize between two peers when **both sides define a shared
folder with the same name**; paths may differ per device. Discovery only
*records* peers — it never grants trust.

## Trust model

Peer trust has four states: `DISCOVERED`, `PAIRING`, `TRUSTED`, `REVOKED`.
Only `TRUSTED` peers exchange manifests and data.

1. On device A: `POST /api/v1/peers/pair {"address":"10.0.0.5:4041"}` sends a
   `PAIR_REQUEST` frame. A learns B's Ed25519 key from B's certificate during
   this first TLS handshake.
2. On device B the request appears as a peer in `PAIRING`, with a
   `PAIR_REQUESTED` event. B approves: `POST /api/v1/peers/{peerId}/approve`.
3. B marks A trusted and notifies it (`PAIR_APPROVED`); A flips its own record
   to `TRUSTED` on receipt. If both sides had already approved, both are
   trusted immediately.

Revocation (`POST /api/v1/peers/{peerId}/revoke`) moves the peer to `REVOKED`:
future handshakes from that peer are refused with a wire error, and pairing
attempts from it are rejected until the record is removed
(`DELETE /api/v1/peers/{peerId}`).

Details and the state machine: [SECURITY.md](SECURITY.md) and
[peer-lifecycle.svg](docs/assets/peer-lifecycle.svg).

## Synchronization algorithm

Sync is **plan-first**. For one folder against one trusted peer:

1. Rescan the local folder (size + mtime shortcuts; re-hash on change).
2. Connect, exchange full manifests (path, size, SHA-256) both ways.
3. Classify every path in the union of both indexes — no file is touched.
4. Execute the plan: conflict notifications, hash-guarded deletions, then
   chunked PUSH/PULL transfers through the transfer queue.

The eight plan states:

| State | Meaning | Direction |
|---|---|---|
| `UNCHANGED` | hashes equal | — |
| `LOCAL_ONLY` | remote never saw it | PUSH |
| `REMOTE_ONLY` | we never had it | PULL |
| `LOCAL_MODIFIED` | local changed since last synced hash | PUSH |
| `REMOTE_MODIFIED` | remote changed since last synced hash | PULL |
| `CONFLICT` | both sides changed (or delete vs. modified) | none — needs resolution |
| `DELETE_LOCAL` | remote deleted a file we still hold unchanged | local deletion |
| `DELETE_REMOTE` | we deleted a file the remote still holds unchanged | remote deletion |

Comparisons use content hashes only. Modification times are a local scan
optimization, never a sync decision. Deletions are hash-guarded: a remote
`DELETE_FILE` is applied only if our current content still matches the hash
the sender planned to delete — diverged data becomes a conflict instead of
being destroyed.

The plan is inspectable (`GET /api/v1/sync/plan?peer=…&folder=…`) before
execution (`POST /api/v1/sync/run`). Open conflicts are skipped during
execution — data safety first.

## Local-first behavior

- Every device keeps a full copy of each shared folder; reading files never
  depends on the network or another peer being online.
- All state — peers, folders, file index, transfer chunk bitmaps, conflicts,
  events, settings — lives in the agent's own SQLite database
  (`~/.meshsync/meshsync.db`). Nothing is stored centrally.
- The agent keeps working offline; when a peer reappears, sync is a diff of
  content hashes, not a re-upload.
- If one side rebuilds its database, `ADOPT` frames heal the common history
  instead of re-transferring identical content.

## Chunked transfer

- Files move in chunks — default **1 MiB**, configurable 64 KiB–16 MiB.
- Every chunk carries its SHA-256 and is verified on arrival; the whole file
  is re-hashed (`VERIFYING`) before it replaces anything.
- Chunks land in a part file (`~/.meshsync/parts/<sha256-16hex>.part`) and the
  final rename into the shared folder is atomic — interrupted transfers never
  leave partial files at the destination.
- The chunk bitmap is persisted in SQLite, so **pause/resume/cancel/retry
  survive agent restarts**; transfers interrupted by a restart are moved to
  `PAUSED` at startup. Resume continues from the first pending chunk.
- Rejected chunks are retried up to 3 times with increasing backoff.
- Bandwidth is a global token bucket applied at chunk granularity, on both
  the send and receive side (`bandwidthLimitBps`, 0 = unlimited). Up to 8
  concurrent transfers (default 2).
- Progress (percent, speed over a 4 s window, ETA, chunks done) comes from
  the live transfer state — nothing is simulated.

See [chunk-transfer.svg](docs/assets/chunk-transfer.svg).

## Conflict handling

When both devices changed the same path since their last common version, the
planner stops and records a conflict (`CONFLICT_DETECTED`, mirrored to both
sides). Resolution is explicit:

- `KEEP_LOCAL` — push the local version; the peer's current copy goes to the
  *peer's* trash first.
- `KEEP_REMOTE` — pull the remote version over the local copy; the local copy
  goes to the local trash first.
- `KEEP_BOTH` — pull the remote version and store it beside the local file as
  `report (conflict from mesh-beta 2026-10-08).pdf` (deterministic:
  `<stem> (conflict from <peerName> <YYYY-MM-DD>)<ext>`); the local version
  wins for the original path.
- `LATER` — documented no-op; the conflict stays open, both versions intact.

Every destructive step goes through the agent trash
(`~/.meshsync/trash/<folder>/`) first, so "losing" a conflict never means
losing the file. See [conflict-resolution.svg](docs/assets/conflict-resolution.svg).

## Security summary

- Peer connections: TLS 1.3, self-signed certificates whose only accepted key
  material is the device's Ed25519 identity key; identity keys are pinned in
  the database after pairing — a changed key is rejected as `IDENTITY_MISMATCH`.
- Trust: explicit pairing approval only; discovery never trusts.
- API: binds `127.0.0.1` by default; optional Bearer token
  (`--api-token`); per-IP rate limiting; 1 MiB request body cap.
- Filesystem: every remote path passes strict validation (no absolute paths,
  no `..`, no backslashes, no NUL) and is re-checked to stay inside the shared
  folder root; symlinks and special files are never synced.

Full threat model and operational notes: [SECURITY.md](SECURITY.md).

## Installation

Requirements: Go 1.25+ (for the agent), g++ with C++20 support (for the
native hashing worker), plus Bun/Node for the web console and Flutter for the
mobile client — each component builds independently.

```sh
# 1. Go agent
cd agent
go build -o meshsync-agent ./cmd/meshsync-agent

# 2. C++20 native hashing worker (optional; the agent falls back to pure-Go
#    hashing and records a NATIVE_FALLBACK event when it is absent)
cd native/cpp
make            # builds meshsync-native
make test       # worker unit tests

# 3. Web console
bun install
bun run dev     # http://localhost:3000

# 4. Flutter client
cd flutter
flutter pub get
flutter run
```

The agent is fully functional without the native worker; it exists to speed
up hashing of large files (≥ 1 MiB) with a dedicated C++20 engine that speaks
a JSON-lines protocol over stdin/stdout with the agent.

### Agent flags

From `agent/cmd/meshsync-agent/main.go` — precedence is
**flags > environment variables > `config.json` > defaults**:

| Flag | Default | Meaning |
|---|---|---|
| `--data-dir` | `~/.meshsync` | state directory (identity, database, trash, parts) |
| `--api-port` | `3040` | local HTTP API port (0 = use config value) |
| `--peer-port` | `4040` | peer TCP port (0 = use config value) |
| `--api-bind` | `127.0.0.1` | local HTTP API bind address |
| `--name` | hostname | device name announced to peers |
| `--api-token` | empty | require `Authorization: Bearer <token>` on the local API |
| `--native-path` | empty | path to the C++ hashing worker binary |
| `--version` | — | print version and exit |

Environment variables: `MESHSYNC_DATA_DIR`, `MESHSYNC_NAME`,
`MESHSYNC_API_BIND`, `MESHSYNC_API_PORT`, `MESHSYNC_PEER_PORT`,
`MESHSYNC_API_TOKEN`, `MESHSYNC_NATIVE_PATH`.

Runtime settings (editable via `PUT /api/v1/settings`, persisted to
`~/.meshsync/config.json`): `deviceName` (≤ 64 chars),
`bandwidthLimitBps` (0 = unlimited), `concurrentTransfers` (1–8, default 2),
`chunkSizeBytes` (64 KiB–16 MiB, default 1 MiB), `discoveryEnabled`,
`skipHiddenFiles`, `autoSyncSeconds` (0 = manual only, otherwise ≥ 10).

State directory layout: `identity.key` (Ed25519, 0600), `peer-cert.pem` /
`peer-key.pem`, `meshsync.db` (SQLite), `config.json`, `trash/<folder>/`,
`parts/`.

## Setup: two devices

On device A (`mesh-alpha`):

```sh
./meshsync-agent --name mesh-alpha --api-port 3040 --peer-port 4040 \
  --data-dir ~/.meshsync-a --native-path ./native/cpp/meshsync-native
```

On device B (`mesh-beta`) — on one machine, give it its own data dir; the
multicast listener uses `SO_REUSEADDR`, so multiple agents coexist on a host:

```sh
./meshsync-agent --name mesh-beta --api-port 3041 --peer-port 4041 \
  --data-dir ~/.meshsync-b --native-path ./native/cpp/meshsync-native
```

Pair A → B (A learns B's key from the TLS handshake):

```sh
curl -s -X POST http://127.0.0.1:3040/api/v1/peers/pair \
  -H 'Content-Type: application/json' -d '{"address":"127.0.0.1:4041"}'
```

Approve on B (use A's `peerId` from the response of `GET /api/v1/peers`):

```sh
curl -s -X POST http://127.0.0.1:3041/api/v1/peers/<A-PEER-ID>/approve
```

Both sides are now `TRUSTED`. Create the same folder name on both sides:

```sh
curl -s -X POST http://127.0.0.1:3040/api/v1/shared-folders \
  -H 'Content-Type: application/json' \
  -d '{"name":"Documents","path":"/home/you/meshsync/shared-a"}'

curl -s -X POST http://127.0.0.1:3041/api/v1/shared-folders \
  -H 'Content-Type: application/json' \
  -d '{"name":"Documents","path":"/home/you/meshsync/shared-b"}'
```

Plan, inspect, then run (from either side):

```sh
curl -s "http://127.0.0.1:3040/api/v1/sync/plan?peer=<B-PEER-ID>&folder=1"
curl -s -X POST http://127.0.0.1:3040/api/v1/sync/run \
  -H 'Content-Type: application/json' -d '{"peer":"<B-PEER-ID>","folder":1}'
```

Behind the sandbox gateway (port 81), every request carries the target port
as a query parameter instead: `GET /api/v1/peers?XTransformPort=3040`.

## Usage

Daily flow through the API (or any client):

- `POST /api/v1/discovery/scan` — one beacon sweep; new peers appear as
  `DISCOVERED` with `PEER_DISCOVERED` events.
- `POST /api/v1/files` — create/replace a file (JSON text or multipart
  binary); `DELETE /api/v1/files?folder=…&path=…` sends it to the trash.
- `GET /api/v1/transfers` — live queue with progress, speed, ETA;
  `POST /api/v1/transfers/{id}/pause|resume|cancel|retry`.
- `GET /api/v1/conflicts` / `POST /api/v1/conflicts/{id}/resolve`.
- `GET /api/v1/events?sinceEventId=…` or the WebSocket stream
  `GET /api/v1/events/ws` for realtime frames
  (`hello`, `event`, `transfer`, `peers`, `device`, `pong`).

Automate periodic sync with `autoSyncSeconds` (settings), which syncs every
folder shared with a trusted online peer.

## Web console

The web console (`src/`) is a Next.js + TypeScript application with nine
workspaces: Dashboard (device), Folders, Files, Peers, Sync, Transfers,
Conflicts, Activity, and Settings.

- Realtime via one WebSocket per selected agent (`/api/v1/events/ws`) pushed
  into TanStack Query caches; reconnect with backoff, full refetch on
  reconnect — stale WS state is never trusted.
- Bilingual: English and Persian (فارسی) with automatic RTL layout, plus a
  dark theme. Preferences persist per browser.
- Registers agent endpoints (Prisma/SQLite-backed) and proxies agent traffic
  through the gateway.

```sh
bun install
bun run dev          # dev server on port 3000
bun run lint         # eslint
```

Open <http://localhost:3000>, add the agent endpoints (3040, 3041), and the
console drives the same REST/WS API documented in [docs/API.md](docs/API.md).

## Flutter client

The Flutter client (`flutter/`) targets Android and Linux, with seven
screens (device, folders/files, peers, sync, transfers, conflicts,
settings), a typed API client generated against the same contract, live
polling of transfer progress, and fa/en localization.

```sh
cd flutter
flutter pub get
flutter analyze
flutter test
flutter run
```

## API summary

The agent API is versioned under `/api/v1` and frozen in
[docs/API.md](docs/API.md): 21 routes covering device info, peers and
pairing, discovery, shared folders, files (list/detail/content/create/delete),
sync (plan/run/sessions), transfers (list/detail/pause/resume/cancel/retry),
conflicts (list/resolve), events (REST + WebSocket), and settings. A Persian
rendering of the contract is in [docs/fa/API_FA.md](docs/fa/API_FA.md).

## Testing

```sh
cd agent && go test ./...          # unit + integration; includes a two-agent e2e suite
cd native/cpp && make test         # C++ worker tests
cd flutter && flutter analyze && flutter test
bun run lint                       # web console
```

The e2e suite (`agent/internal/app/e2e_test.go`) boots two real agents on
ephemeral ports with temp directories, pairs them over the real protocol,
and verifies transfer integrity and conflict handling end to end.

Repo helper scripts (bash, safe to re-run) wrap the common flows:
`scripts/run-agents.sh` starts/stops the two demo agents,
`scripts/demo-sync.sh` is an end-to-end pairing + sync + hash-verification
demo through the public API, `scripts/validate-release.sh` is the local
pre-release gate, `scripts/build-all.sh` builds agent + native worker, and
`scripts/gen-checksums.sh` / `scripts/gen-sbom.sh` produce release metadata.

## Performance notes

Qualitative, code-derived — no fabricated numbers:

- Local rescans skip re-hashing when size and mtime are unchanged, so steady
  state is a directory walk, not a full re-hash.
- The C++ worker hashes large files (≥ 1 MiB) in a separate process, keeping
  the Go agent responsive; below the threshold Go hashes inline with 1 MiB
  buffers.
- Progress events are throttled (one per ~125 ms per transfer; WS transfer
  frames every 8th chunk), so a fast transfer cannot flood the event stream.
- The bandwidth limiter applies at chunk granularity, which keeps the cap
  predictable without starving small transfers.
- Measured behavior of any specific workload should be benchmarked on your
  own hardware; the repo deliberately ships no invented benchmark figures.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Peers never appear in discovery | Discovery is UDP multicast on `239.255.42.42:4100` — same subnet only; some Wi-Fi networks block multicast. Pair manually with `POST /peers/pair {"address":"host:4041"}`. |
| `PEER_OFFLINE` on pair/run | Wrong peer port, firewall, or the other agent is not running. Check `GET /api/v1/health` on the target. |
| `IDENTITY_MISMATCH` wire error | The peer's identity key changed (fresh data dir). Remove the old record (`DELETE /api/v1/peers/{id}`) and re-pair. |
| Sync does nothing (`UNCHANGED` everywhere) | That is success — hashes match. Run `POST /shared-folders/{id}/rescan` if you changed files while the agent was down. |
| Transfer stuck in `PAUSED` | It was interrupted (restart or pause). `POST /transfers/{id}/resume` continues from the persisted chunk bitmap. |
| Conflict on a file you only edited once | The other side edited it too since the last sync — check `GET /conflicts` for both hashes and mtimes, then resolve. |
| `NATIVE_FALLBACK` event | The C++ worker is missing or failed; the agent runs pure-Go hashing. Point `--native-path` at a built `meshsync-native`. |
| `429 RATE_LIMITED` | The API allows 600 requests / 10 s per IP; a runaway polling loop trips it. |

## Known limitations

- **LAN only.** No relay, no NAT traversal, no port punching; peers must be
  mutually reachable over TCP (and discovery needs multicast on one subnet).
- **Single-user trust model.** Any trusted peer can read and write everything
  in folders you share with it; there are no per-user or per-file ACLs.
- **Discovery is subnet-scoped UDP multicast**; it does not cross routed
  networks. Manual pairing works across subnets as long as TCP is routable.
- **Two devices per folder pair** is the tested topology (the demo and the
  e2e suite); more peers can be trusted, but folder sync runs pairwise.
- Symlinks, sockets, device files and other non-regular files are ignored
  (never hashed, never synced).
- Hidden (dot) files sync by default; toggle `skipHiddenFiles` to exclude
  them.
- The peer TCP listener binds `0.0.0.0` — restrict access at the firewall if
  untrusted devices share the LAN (the TLS/pinning layer still gates trust).
- `REMOTE_ONLY` healing is one-directional: a rebuilt *remote* database is
  healed by pushes; a rebuilt *local* one pulls, but files present only in
  the local index without history are re-pushed rather than deduplicated.
- No selective sync patterns (include/exclude globs) yet; folder granularity
  only.

## Releases

MeshSync ships versioned milestones (see [CHANGELOG.md](CHANGELOG.md)):
`0.1.0` agent core, `0.2.0` web console, `0.3.0` Flutter client, `0.4.0`
operations (docs/CI/Docker/SBOM), `1.0.0` stable. Each tag goes through the
pipeline in [release-pipeline.svg](docs/assets/release-pipeline.svg) —
validate, package, checksum, SBOM, then the published release with binaries and
a CycloneDX SBOM. The Docker image (`deploy/Dockerfile`, multi-arch
linux/amd64 + arm64) contains the pure-Go agent only — the C++ worker is
optional and not bundled; the agent falls back to Go hashing inside the
container. Release process walkthrough (Persian):
[docs/fa/RELEASE_FA.md](docs/fa/RELEASE_FA.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) — development setup, layout, test
commands per component, commit style, and the review checklist.

---

Copyright © 2026 Parsa Fathi. Licensed under the Apache License, Version 2.0
([LICENSE](LICENSE)).
