# MeshSync — Docker deployment

Run the MeshSync agent in Docker: a single self-contained image with the Go
agent (API + peer sync + SQLite state). This directory contains:

| File | Purpose |
| --- | --- |
| `Dockerfile` | Multi-stage image: `golang:1.25-alpine` build → `alpine:3.22` runtime, non-root user, healthcheck |
| `docker-compose.yml` | Two-agent demo (pairing + sync) on a private bridge network |

## Image

```
ghcr.io/parsafathii/meshsync:<version>   # e.g. 0.1.0
ghcr.io/parsafathii/meshsync:latest
```

Built by `.github/workflows/docker.yml` on every `v*` tag push and pushed to
GHCR with the GitHub-provided `GITHUB_TOKEN` (no personal credentials).

### What is inside — and what is not

* **Inside**: the `meshsync-agent` binary (pure Go, `CGO_ENABLED=0` —
  modernc.org/sqlite), running as the non-root user `meshsync` (uid/gid
  10001) on `alpine:3.22`.
* **Not inside**: the native C++20 hashing worker. The agent falls back to
  pure-Go hashing and emits a `NATIVE_FALLBACK` event (see `docs/API.md`).
  If you need the worker, build `native/cpp` on the host and mount it:

  ```sh
  docker run -v $PWD/native/cpp/bin/meshsync-native:/usr/local/bin/meshsync-native:ro \
         ghcr.io/parsafathii/meshsync:latest \
         --native-path /usr/local/bin/meshsync-native
  ```

### Ports

| Port | Purpose |
| --- | --- |
| 3040 | Local HTTP API + WebSocket events (`/api/v1/health`, see `docs/API.md`) |
| 4040 | Peer sync protocol (TLS 1.3, pinned device keys) |

### Volume

`/data` holds all agent state (SQLite database, Ed25519 identity + TLS
certificate, trash). Mount a volume or bind-mount a host directory — losing
`/data` means losing the device identity and folder index.

## Quick start (single agent)

```sh
docker build -f deploy/Dockerfile -t meshsync:local .
docker run -d --name meshsync \
  -p 127.0.0.1:3040:3040 -p 4040:4040 \
  -v meshsync-data:/data \
  meshsync:local
curl -s http://127.0.0.1:3040/api/v1/health
```

The container healthcheck polls `/api/v1/health` every 30 s (`docker ps`
shows `healthy`).

## Two-agent demo (docker-compose)

```sh
cd deploy
docker compose up -d --build
docker compose ps          # wait for both containers to report healthy
```

Host port map:

| Service | API (local only) | Peer (published) |
| --- | --- | --- |
| mesh-alpha | 127.0.0.1:3040 | 4040 |
| mesh-beta | 127.0.0.1:3041 | 4041 |

### Pairing the two agents

Pairing is explicit — nothing syncs until a human approves it. Agent alpha
requests pairing; agent beta approves:

```sh
# 1. alpha requests pairing with beta (compose-internal DNS + peer port):
curl -s -X POST http://127.0.0.1:3040/api/v1/peers/pair \
     -H 'Content-Type: application/json' \
     -d '{"address": "mesh-beta:4040"}'

# 2. beta sees alpha as PAIRING and approves it:
PEER_ID=$(curl -s http://127.0.0.1:3041/api/v1/peers |
           jq -r '.peers[] | select(.trust == "PAIRING") | .peerId')
curl -s -X POST "http://127.0.0.1:3041/api/v1/peers/${PEER_ID}/approve"

# 3. both sides now show trust TRUSTED:
curl -s http://127.0.0.1:3040/api/v1/peers | jq '.peers[] | {name, trust, online}'
```

### Sharing a folder

Define a folder with the **same name** on both agents (folders synchronize
between peers by matching name — see `docs/API.md`):

```sh
mkdir -p ~/meshsync/shared-a ~/meshsync/shared-b

curl -s -X POST http://127.0.0.1:3040/api/v1/shared-folders \
     -H 'Content-Type: application/json' \
     -d '{"name": "Documents", "path": "'"$HOME"'/meshsync/shared-a"}'

curl -s -X POST http://127.0.0.1:3041/api/v1/shared-folders \
     -H 'Content-Type: application/json' \
     -d '{"name": "Documents", "path": "'"$HOME"'/meshsync/shared-b"}'

# plan first (dry run), then execute:
FOLDER_ID=1
PEER_ID=$(curl -s http://127.0.0.1:3040/api/v1/peers | jq -r '.peers[0].peerId')
curl -s "http://127.0.0.1:3040/api/v1/sync/plan?peer=${PEER_ID}&folder=${FOLDER_ID}" | jq '.summary'
curl -s -X POST http://127.0.0.1:3040/api/v1/sync/run \
     -H 'Content-Type: application/json' \
     -d "{\"peer\": \"${PEER_ID}\", \"folder\": ${FOLDER_ID}}" | jq '.sessionId'
```

The local non-docker equivalent of this whole flow is
`scripts/demo-sync.sh`.

## Security notes

* Inside the container the API binds `0.0.0.0` (required for port publishing
  to work); the compose file publishes the API only on `127.0.0.1`. If you
  expose the API to a LAN, pass `--api-token <token>` and require
  `Authorization: Bearer <token>` on every request.
* The peer port (4040) is published on all interfaces in compose so external
  devices can pair. Peer connections are TLS 1.3 with pinned keys; unknown
  peers never sync anything.
* No secrets are baked into the image; identity keys are generated on first
  start inside `/data`.

## Operational notes

* `docker compose down` keeps the named volumes (`meshsync-alpha-data`,
  `meshsync-beta-data`); `docker compose down -v` destroys all agent state.
* `init: true` (compose) / `--init` (docker run) gives the agent a
  signal-forwarding PID 1 — the agent does not install SIGTERM handlers yet,
  so without it `docker stop` waits for the grace period and SIGKILLs.
* Logs: `docker logs mesh-alpha` (agent writes to stdout).

## Why the web console is not in compose

The web console is a development tool (Next.js dev server, bun, Prisma
migrations against a local SQLite file). It consumes the agent API but owns
no sync state. Run it on your workstation (`bun run dev` at the repo root)
and point it at the agent URLs above; containerizing the dev harness would
add nothing to the sync demo.
