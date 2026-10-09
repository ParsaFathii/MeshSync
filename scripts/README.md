# MeshSync scripts

Development, release and demo helpers. All scripts are bash, `set -euo
pipefail`, and safe to re-run unless noted. Run them from anywhere — they
locate the repository root themselves.

| Script | Purpose |
| --- | --- |
| `run-agents.sh` | Start (or `--stop`) two local agents mesh-alpha (API 3040 / peer 4040) and mesh-beta (API 3041 / peer 4041) with state, logs and PID files under `.runtime/`; idempotent; `--native-path` optional (auto-detected from `native/cpp/bin/meshsync-native`). |
| `build-all.sh` | Build the Go agent into `agent/bin/meshsync-agent` and the native worker via `make -C native/cpp`; prints the artifact list with sizes. Uses `/home/z/opt/go/bin/go` if present, else `go` from PATH. |
| `gen-checksums.sh` | Emit `SHA256SUMS` lines for given files (`gen-checksums.sh FILE... > SHA256SUMS`, double-read verification) or verify an existing file (`--check SHA256SUMS`). |
| `gen-sbom.sh` | Generate a CycloneDX 1.5 JSON SBOM from the real manifests (`agent/go.mod`, `package.json`) — no network, no invented entries; stdout or file argument; requires `jq`. |
| `validate-release.sh` | Local pre-release gate: Go vet+test, native `make test`, web lint, Flutter analyze+test — each guarded (WARN + skip when the tool/component is absent), any executed failure exits non-zero. |
| `demo-sync.sh` | End-to-end demo: ensures both agents, pairs them, creates `.runtime/demo-{a,b}` shared folders, writes sample files through the API, runs a sync session, and verifies transferred file hashes — prints PASS/FAIL. Requires `curl` + `jq`. |

## Notes

* `.runtime/` (agent state, demo folders, logs) is runtime output — it is
  safe to delete when no agent is running (`scripts/run-agents.sh --stop`
  first).
* `demo-sync.sh` deliberately talks only to the public HTTP API documented
  in `docs/API.md` — it doubles as a live contract test.
