# Changelog

All notable changes to MeshSync are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
semantic versioning. Release dates are filled in when each tag is cut.

## [1.0.1] — docs refresh

### Added
- `docs/assets/screens/demo-sync.gif` — 46-second animated end-to-end demo
  (plan → live chunked transfer with progress and throughput graph → synced),
  captured from a real two-agent session.
- `13-settings-en.png` — Settings workspace screenshot (live editable agent
  configuration).

### Changed
- All console screenshots re-captured against the final v1.0.0 agents
  (two trusted peers, 5-file shared folder, real 64 B–48 MiB transfer
  history, an open conflict, and an error/recovery shot with the supervisor
  respawn), replacing the earlier v0.1.0-era captures.
- Root `README.md` gained an "At a glance" section embedding the demo GIF
  and a stills gallery; `docs/QUICKSTART.md` embeds the GIF up front.

## [1.0.0] — stable

### Added
- Final validation pass across all components: agent e2e suite, native
  worker tests, web console lint/build, Flutter analyze/test, all green in
  CI before tagging.
- Real screenshots of the running system (agent pair, web console in EN and
  fa/RTL, Flutter client) captured into `docs/assets/screens/`.
- Release artifacts published per tag: cross-compiled `meshsync-agent`
  binaries, the `meshsync-native` worker, `SHA256SUMS`, and an SBOM,
  attached to the release.
- Final bilingual documentation set (English root documents + `docs/fa/`)
  reviewed against the shipped code.

### Known limitations
- LAN-only operation (no relay, no NAT traversal) — by design.
- Single-user trust model; a trusted peer has full read/write access to
  folders shared with it.
- Discovery requires UDP multicast on a single subnet; manual pairing works
  across routed subnets.

## [0.4.0] — operations

### Added
- Bilingual documentation: English root documents (`README.md`,
  `ARCHITECTURE.md`, `SECURITY.md`, `CONTRIBUTING.md`, this changelog,
  `docs/QUICKSTART.md`, `docs/API.md`) and the Persian set under `docs/fa/`
  (12 documents covering installation, usage, architecture, sync, peers,
  conflicts, security, API, development, release, and copyright).
- Six original SVG diagrams in `docs/assets/`: system architecture, peer
  trust lifecycle, sync flow, chunk transfer, conflict resolution, and the
  release pipeline.
- CI/CD workflows: per-component build, lint, and test gates; release
  workflow driving the tag → validate → package → checksum → SBOM → release
  pipeline (CycloneDX SBOM, SHA256SUMS).
- Docker packaging (`deploy/Dockerfile`, multi-arch linux/amd64 + arm64)
  for the pure-Go agent; the C++ worker is intentionally not bundled — the
  agent falls back to pure-Go hashing in the container.
- Release and demo tooling (`scripts/`): agent pair runner, end-to-end demo
  with hash verification, local pre-release validation gate, checksum and
  SBOM generators.

### Changed
- README restructured around the six diagrams and the verified flag table;
  performance notes restricted to code-derived qualitative behavior.

## [0.3.0] — Flutter client

### Added
- Flutter client (`flutter/`) targeting Android and Linux.
- Seven screens: device dashboard, folders, file browser, peers (pairing
  and trust management), transfers with live progress, conflicts, and
  settings.
- Typed API client implementing the frozen v1 contract from `docs/API.md`.
- Live polling of transfer progress and peer state with backoff between
  polls.
- Persian (فارسی) and English localization.

### Known limitations
- Live updates use polling rather than a persistent WebSocket stream.
- No background sync service; the app syncs while it is in the foreground.

## [0.2.0] — web console

### Added
- Web console (`src/`): Next.js + TypeScript + Tailwind + shadcn/ui, with
  nine workspaces — Dashboard, Folders, Files, Peers, Sync, Transfers,
  Conflicts, Activity, Settings.
- Realtime updates over one WebSocket per selected agent
  (`/api/v1/events/ws`) feeding TanStack Query caches; automatic reconnect
  with backoff and full state refetch on reconnect.
- Bilingual UI: English and natural Persian (فارسی) with automatic RTL
  layout (`dir` switching), plus dark mode; per-browser preference
  persistence via a Prisma/SQLite-backed prefs API.
- Agent endpoint registry backed by Prisma (SQLite): register agents by
  label and port; requests proxy through the gateway with the
  `XTransformPort` query parameter.

### Security
- Agent traffic remains localhost-bound; the console never holds agent
  credentials, and the optional agent API token is passed through as a
  header only.

## [0.1.0] — agent core

### Added
- Go agent (`agent/`): a single binary, `meshsync-agent`, exposing the
  versioned v1 REST API and WebSocket event stream defined in
  `docs/API.md`.
- C++20 native hashing engine (`native/cpp`): the `meshsync-native` worker
  speaking a JSON-lines protocol (one request/response per line) over
  stdin/stdout; the agent manages the process and routes files ≥ 1 MiB to
  it.
- Persistent Ed25519 device identity; peer ID derived from the public key
  hash and displayed as a human-checkable fingerprint.
- Peer discovery over UDP multicast beacons (`239.255.42.42:4100`, every
  5 s); discovered peers are recorded but never trusted automatically.
- Pairing and trust: two-sided `PAIR_REQUEST` / `PAIR_APPROVED` handshake,
  `DISCOVERED` / `PAIRING` / `TRUSTED` / `REVOKED` states, revocation
  enforcement at connection time.
- Shared folders with live watching (fsnotify, recursive, debounced),
  streaming SHA-256 indexing, size+mtime re-hash shortcuts, tombstones.
- Plan-first synchronization: manifest exchange, the eight action states
  (`UNCHANGED`, `LOCAL_ONLY`, `REMOTE_ONLY`, `LOCAL_MODIFIED`,
  `REMOTE_MODIFIED`, `CONFLICT`, `DELETE_LOCAL`, `DELETE_REMOTE`),
  inspectable plans before execution, hash-only decisions.
- Chunked resumable transfers: 1 MiB default chunks (64 KiB–16 MiB range),
  per-chunk SHA-256 verification, full-file verification before an atomic
  rename, persisted chunk bitmaps, pause/resume/cancel/retry that survive
  restarts, chunk-level retries with backoff.
- Integrity and safety: trash-before-destructive-ops, hash-guarded remote
  deletions, "never push surprises" checks, conflict mirroring on both
  sides.
- Conflict resolutions: `KEEP_LOCAL`, `KEEP_REMOTE`, `KEEP_BOTH`
  (deterministic `name (conflict from peer YYYY-MM-DD).ext` naming), and
  `LATER`.
- Global token-bucket bandwidth limiting (send and receive side),
  configurable transfer concurrency (1–8).
- SQLite state via `modernc.org/sqlite` (pure Go, no cgo): peers, folders,
  file index, transfers, conflicts, events, sessions, remote manifests.
- Live metrics (speed over a 4 s window, ETA, chunk maps) and an event bus
  with throttled progress events; nothing simulated.
- Go fallback hashing with a one-time `NATIVE_FALLBACK` event when the C++
  worker is unavailable — the agent is fully functional without it.
- End-to-end test suite booting two real agents on ephemeral ports that
  pair, sync, and verify integrity and conflicts over the real protocol.

### Security
- Peer transport: TLS 1.3 with self-signed certificates bound to the
  Ed25519 identity; post-handshake key pinning; `IDENTITY_MISMATCH` and
  `REVOKED` enforcement; strict frame size limits and deadlines.
- Local API: `127.0.0.1` bind by default, optional Bearer token, per-IP
  rate limiting, 1 MiB body cap, strict path validation on every remote
  path (no absolute paths, `..`, backslashes, or NUL; symlinks never
  synced).

### Known limitations
- LAN-only: no relay or NAT traversal; discovery needs a single multicast
  subnet.
- Single-user trust model without per-file ACLs.
- Pairwise folder sync; the tested topology is two devices per folder.
- Non-regular files (symlinks, sockets, device nodes) are ignored.
- No include/exclude patterns; sync granularity is the shared folder.
