# Contributing to MeshSync

Practical guide for working on the codebase. The contract is frozen in
[docs/API.md](docs/API.md) — agent, web, and Flutter all implement that one
document; change the contract first (as a proposal), then the code.

## Development setup

- **Go agent:** Go 1.25+ (`agent/go.mod`). No cgo — SQLite is
  `modernc.org/sqlite`, so `go build` just works.
- **Native worker:** g++ with C++20 support (`native/cpp`, built with `make`).
- **Web console:** Bun (or Node) 18+ (`bun install` in the repo root).
- **Flutter client:** Flutter SDK 3.x (`flutter/`).

```sh
git clone https://github.com/ParsaFathii/MeshSync
cd MeshSync

# agent
cd agent && go build ./... && go test ./...

# native hashing worker
cd native/cpp && make && make test

# web console
bun install
bun run dev        # http://localhost:3000
bun run lint

# flutter client
cd flutter
flutter pub get
flutter analyze
flutter test
```

## Repository layout

```
agent/           Go agent (cmd/meshsync-agent + internal/*)
native/cpp/      C++20 hashing worker + tests
flutter/         Flutter client (Android, Linux)
src/             web console (Next.js, TS, Tailwind, shadcn/ui)
docs/            API.md, QUICKSTART.md, assets/ (SVG diagrams), fa/ (Persian)
prisma/, db/     web console agent-registry storage
.github/         CI workflows, issue templates
deploy/          Docker packaging
scripts/         release / tooling scripts
```

Component boundaries are strict: clients consume the agent API; the agent
never imports client code; the native worker is a separate process speaking
the documented JSON-lines protocol. Keep it that way — it is what makes each
piece independently buildable and testable.

## Test commands per component

| Component | Command | Notes |
|---|---|---|
| Go agent | `cd agent && go test ./...` | includes the two-agent e2e suite (`internal/app/e2e_test.go`) on ephemeral ports |
| Go agent (narrow) | `go test ./internal/sync/...` | planner semantics, conflict naming |
| Native worker | `cd native/cpp && make test` | hash engine unit tests |
| Web console | `bun run lint` | eslint across `src/` |
| Flutter | `flutter analyze && flutter test` | static analysis + widget/unit tests |

Running a manual two-agent setup during development (different data dirs):

```sh
./meshsync-agent --name alpha --api-port 3040 --peer-port 4040 --data-dir ~/.meshsync-a
./meshsync-agent --name beta  --api-port 3041 --peer-port 4041 --data-dir ~/.meshsync-b
```

Pair them, share a folder name on both, and drive sync through the console or
curl (see [docs/QUICKSTART.md](docs/QUICKSTART.md)).

## Commit style

- Conventional-ish prefixes: `agent:`, `native:`, `web:`, `flutter:`,
  `docs:`, `ci:`, `chore:` — scoped to the component you touched.
- Subject in imperative mood, ≤ ~72 chars, no trailing period.
  Good: `agent: skip re-hash when size+mtime unchanged in rescan`.
- Body explains *why* when the reason is not obvious from the diff. Reference
  the API.md section when behavior is contract-relevant.
- One logical change per commit; generated files and formatting noise do not
  ride along with feature commits.

## Pull request expectations

- The component's tests and lint pass locally (see table above).
- If you changed agent behavior, the e2e suite still passes and any new
  endpoint/field is reflected in `docs/API.md` (and the Persian
  counterpart if user-visible).
- If you touched the wire protocol, describe compatibility: old agents
  talking to new ones (frames are versioned by HELLO version strings).
- New user-visible strings in the console or Flutter client come with both
  `en` and `fa` entries.
- No secrets, tokens, or absolute paths from your machine in the diff.

## Code review checklist

Reviewers (and authors, pre-PR) go through this list — it mirrors the bug
classes this codebase is most exposed to:

- [ ] **Races:** shared maps/slices guarded (`peersMu`, `Manager.mu`,
      `Bandwidth.mu`, `cfgMu`); `go test -race ./...` clean.
- [ ] **Goroutine leaks:** every `go func` has an exit condition; listeners,
      tickers, and watcher loops stop on shutdown; `defer wg.Done()` present
      where `wg.Add` was called.
- [ ] **Unchecked errors:** filesystem and DB errors are surfaced (events or
      API errors), not swallowed with `_ =`; where `_ =` is intentional
      (best-effort events), a short comment says why.
- [ ] **Unsafe fs operations:** all writes go through `SafeJoin`; no `os.Remove`
      without trash-first for shared content; no partial files at final
      paths (write to `parts/`, then rename).
- [ ] **Hash-before-destroy:** deletions and overwrites check the expected
      content hash; diverged data becomes a conflict, never a casualty.
- [ ] **Frame/JSON hygiene:** new wire messages respect the 17 MiB frame cap
      and decode failures close the connection instead of hanging.
- [ ] **Blocking calls:** handlers do not block the read loop; long work is
      dispatched to the manager/session goroutines.
- [ ] **Config validation:** new settings are range-checked in `config.Validate`
      and applied live via `ApplyConfig` where relevant.
- [ ] **Docs:** behavior changes are reflected in API.md / README /
      docs/fa as appropriate.

## Documentation

Docs are code: if you change flags, endpoints, defaults, or wire behavior,
update the matching English and Persian documents in the same PR. Diagrams in
`docs/assets/` are hand-maintained SVGs — edit them as source, do not replace
them with raster exports.

## Licensing

By contributing you agree your contributions are licensed under the Apache
License 2.0, copyright Parsa Fathi.
