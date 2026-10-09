# MeshSync Local Agent API — v1

The MeshSync agent runs on every device and exposes a versioned HTTP API plus
a WebSocket event stream. The web dashboard and the Flutter client are pure
consumers of this API. All state (peers, folders, file index, transfers,
conflicts, events) is owned by the agent and persisted in its local SQLite
database.

* Base URL (local): `http://127.0.0.1:{apiPort}`
* Content type: `application/json` unless noted otherwise
* All timestamps are RFC 3339 UTC strings
* All hashes are lowercase hex SHA-256 strings
* Ports: API `3040` (device A) / `3041` (device B); peer TCP `4040` / `4041`

Through the sandbox gateway every request must append the target port as the
`XTransformPort` query parameter, e.g. `GET /api/v1/device?XTransformPort=3040`.

## Error format

Every non-2xx response uses one envelope:

```json
{
  "error": {
    "code": "PEER_NOT_FOUND",
    "message": "peer 9f2c... is not known to this device"
  }
}
```

Common codes: `BAD_REQUEST`, `VALIDATION`, `NOT_FOUND`, `PEER_NOT_FOUND`,
`FOLDER_NOT_FOUND`, `TRANSFER_NOT_FOUND`, `CONFLICT_NOT_FOUND`, `PEER_OFFLINE`,
`NOT_TRUSTED`, `IO_ERROR`, `UNAUTHORIZED`, `RATE_LIMITED`.

## Enumerations

* Peer trust: `DISCOVERED`, `PAIRING`, `TRUSTED`, `REVOKED`
* Transfer status: `QUEUED`, `PREPARING`, `TRANSFERRING`, `VERIFYING`,
  `PAUSED`, `COMPLETED`, `FAILED`, `CANCELLED`
* Transfer direction: `PUSH` (this device sends), `PULL` (this device receives)
* File sync state: `SYNCED`, `PENDING`, `SYNCING`, `CONFLICT`, `LOCAL_ONLY`
* Sync plan action state: `UNCHANGED`, `LOCAL_ONLY`, `REMOTE_ONLY`,
  `LOCAL_MODIFIED`, `REMOTE_MODIFIED`, `CONFLICT`, `DELETE_LOCAL`, `DELETE_REMOTE`
* Conflict status: `OPEN`, `RESOLVED`
* Event severity: `INFO`, `WARN`, `ERROR`
* Event types: `PEER_DISCOVERED`, `PAIR_REQUESTED`, `PAIR_APPROVED`,
  `PEER_REVOKED`, `PEER_ONLINE`, `PEER_OFFLINE`, `SYNC_STARTED`,
  `SYNC_COMPLETED`, `SYNC_FAILED`, `TRANSFER_STARTED`, `TRANSFER_PROGRESS`,
  `TRANSFER_COMPLETED`, `TRANSFER_FAILED`, `TRANSFER_PAUSED`,
  `TRANSFER_RESUMED`, `TRANSFER_CANCELLED`, `CONFLICT_DETECTED`,
  `CONFLICT_RESOLVED`, `FILE_INDEXED`, `FILE_CHANGED`, `FILE_DELETED`,
  `FOLDER_ADDED`, `FOLDER_REMOVED`, `SETTINGS_UPDATED`, `NATIVE_FALLBACK`

## Endpoints

### GET /api/v1/health

```json
{ "status": "ok", "version": "0.1.0", "uptimeSeconds": 1284, "dbOk": true }
```

### GET /api/v1/device

```json
{
  "peerId": "9f2c8a1b7d34e5f6",
  "name": "mesh-alpha",
  "version": "0.1.0",
  "platform": "linux/amd64",
  "startedAt": "2026-10-08T09:14:00Z",
  "apiPort": 3040,
  "peerPort": 4040,
  "keyFingerprint": "SHA256:4kL9...2xQm",
  "nativeEngine": "cpp-worker-1.0.0",
  "stats": {
    "folders": 1,
    "filesIndexed": 34,
    "bytesIndexed": 8123401,
    "peersTrusted": 1,
    "peersOnline": 1,
    "transfersActive": 1,
    "transfersCompleted": 7,
    "conflictsOpen": 0,
    "lastSyncAt": "2026-10-08T10:02:33Z"
  }
}
```

### GET /api/v1/peers

```json
{
  "peers": [
    {
      "peerId": "31aa0c44bb55ff90",
      "name": "mesh-beta",
      "address": "127.0.0.1:4041",
      "trust": "TRUSTED",
      "online": true,
      "version": "0.1.0",
      "platform": "linux/amd64",
      "lastSeen": "2026-10-08T10:04:12Z",
      "addedAt": "2026-10-07T18:20:01Z",
      "sharedFolders": 1
    }
  ]
}
```

### POST /api/v1/peers/pair

Body: `{ "address": "127.0.0.1:4041" }`

Sends a pairing request to the peer at that address. The remote device sees
the request as a peer in state `PAIRING` and must approve it explicitly.

Response: `{ "peer": { ...same shape as above, "trust": "PAIRING" } }`

Errors: `PEER_OFFLINE` (nothing reachable at address), `VALIDATION`.

### POST /api/v1/peers/{peerId}/approve

Approves a pairing request. If the peer already marked this device as
trusted, both sides end up `TRUSTED` immediately.

Response: `{ "peer": { ... } }`

### POST /api/v1/peers/{peerId}/revoke

Moves the peer to `REVOKED`. Existing connections are closed and future
pairing attempts from that peer are refused until it is removed.

Response: `{ "peer": { ... } }`

### DELETE /api/v1/peers/{peerId}

Removes the peer record entirely.

Response: `204` (empty).

### POST /api/v1/discovery/scan

Runs one discovery sweep (UDP multicast beacon listener). Newly seen peers
are recorded as `DISCOVERED` (never trusted automatically) and emit
`PEER_DISCOVERED` events.

Response: `{ "found": [ { "peerId": "...", "name": "...", "address": "127.0.0.1:4041", "version": "0.1.0" } ] }`

### GET /api/v1/shared-folders

```json
{
  "folders": [
    {
      "id": 1,
      "name": "Documents",
      "path": "/home/z/meshsync/shared-a",
      "fileCount": 12,
      "totalBytes": 1234567,
      "lastScanAt": "2026-10-08T09:15:02Z"
    }
  ]
}
```

Folders synchronize between two trusted peers when both sides define a
shared folder with the same name.

### POST /api/v1/shared-folders

Body: `{ "name": "Documents", "path": "/home/z/meshsync/shared-a" }`

The path must be an existing absolute directory. Response: `{ "folder": { ... } }`

### DELETE /api/v1/shared-folders/{id}

Stops tracking the folder. Files on disk are kept. Optional body
`{ "deleteFiles": true }` removes the directory contents (sent to the agent
trash first). Response: `204`.

### POST /api/v1/shared-folders/{id}/rescan

Walks the folder, hashes every file (streaming), updates the index, and
tombstones removed files. Response:

```json
{ "folder": { ... }, "scanned": 40, "changed": 3, "removed": 1, "durationMs": 512 }
```

### GET /api/v1/files?folder={id}&path={relativeDir}

Lists a directory inside a shared folder, merged with index state. `path`
is empty for the folder root. Directory entries are returned sorted
(directories first, then files, both case-insensitive).

```json
{
  "folder": { "id": 1, "name": "Documents" },
  "path": "projects/meshsync",
  "entries": [
    {
      "name": "assets",
      "type": "dir",
      "fileCount": 3,
      "totalBytes": 99823
    },
    {
      "name": "notes.txt",
      "type": "file",
      "size": 921,
      "mtime": "2026-10-08T07:11:45Z",
      "hash": "60b27b2f...c81",
      "syncState": "SYNCED",
      "lastSyncedHash": "60b27b2f...c81",
      "remotePeers": [ "31aa0c44bb55ff90" ]
    }
  ]
}
```

`remotePeers` lists trusted peers whose latest manifest for this file
matches the local hash (i.e. up-to-date copies exist there).

### GET /api/v1/files/detail?folder={id}&path={relativeFile}

Full detail for one file, including its chunk map:

```json
{
  "type": "file",
  "name": "notes.txt",
  "folder": { "id": 1, "name": "Documents" },
  "path": "projects/meshsync/notes.txt",
  "size": 921,
  "mtime": "2026-10-08T07:11:45Z",
  "hash": "60b27b2f...c81",
  "syncState": "PENDING",
  "lastSyncedHash": "31bb...aa0",
  "chunkSize": 1048576,
  "chunks": [ { "index": 0, "size": 921, "state": "DONE" } ],
  "peers": {
    "31aa0c44bb55ff90": {
      "hash": "31bb...aa0", "size": 900, "mtime": "...", "seenAt": "..."
    }
  }
}
```

### GET /api/v1/files/content?folder={id}&path={relativeFile}

Streams the file content. `Content-Type: application/octet-stream`,
`Content-Disposition: attachment; filename="..."`. Range requests are not
required.

### POST /api/v1/files

Creates or replaces a file with real content, then indexes it.

* JSON body: `{ "folder": 1, "path": "notes.txt", "content": "text...", "encoding": "utf8" }`
* Multipart body: fields `folder`, `path`, and one `file` part (binary)

Response: the same shape as `/api/v1/files/detail`.

### DELETE /api/v1/files?folder={id}&path={relativeFile}

Moves the file into the agent trash (`.meshsync/trash`), tombstones it in
the index, and emits `FILE_DELETED`. Response: `204`.

### GET /api/v1/sync/plan?peer={peerId}&folder={id}

Connects to the peer, exchanges folder manifests, and classifies every path
without touching any file. The plan is inspectable before execution.

```json
{
  "peer": { "peerId": "31aa...", "name": "mesh-beta" },
  "folder": { "id": 1, "name": "Documents" },
  "generatedAt": "2026-10-08T10:01:22Z",
  "summary": {
    "total": 40, "pull": 2, "push": 1, "deleteLocal": 0, "deleteRemote": 1,
    "conflicts": 1, "unchanged": 36
  },
  "actions": [
    {
      "relPath": "report.pdf",
      "state": "LOCAL_MODIFIED",
      "direction": "PUSH",
      "size": 80211,
      "localHash": "9f2c...",
      "remoteHash": "31bb...",
      "lastSyncedHash": "31bb..."
    },
    {
      "relPath": "photo.jpg",
      "state": "CONFLICT",
      "direction": "NONE",
      "size": 80211,
      "localHash": "aa01...",
      "remoteHash": "ff09...",
      "lastSyncedHash": "31bb..."
    }
  ]
}
```

### POST /api/v1/sync/run

Body: `{ "peer": "31aa...", "folder": 1 }`

Executes the plan for that folder. Transfer-level progress is delivered via
events / WebSocket. Response: `{ "sessionId": "b21f...", "plan": { ...same shape as above } }`

Errors: `PEER_OFFLINE`, `NOT_TRUSTED`, `FOLDER_NOT_FOUND`.

### GET /api/v1/sync/sessions

```json
{
  "sessions": [
    {
      "id": "b21f...",
      "peerId": "31aa...",
      "peerName": "mesh-beta",
      "folderId": 1,
      "folderName": "Documents",
      "startedAt": "...",
      "finishedAt": "...",
      "status": "COMPLETED",
      "transferred": 240133,
      "filesTransferred": 3,
      "error": null
    }
  ]
}
```

### GET /api/v1/transfers?limit=50&status=TRANSFERRING

```json
{
  "transfers": [
    {
      "id": "t-1f0a...",
      "peerId": "31aa...",
      "peerName": "mesh-beta",
      "folderId": 1,
      "folderName": "Documents",
      "relPath": "videos/demo.mp4",
      "direction": "PULL",
      "size": 268435456,
      "transferred": 134217728,
      "progressPct": 50,
      "speedBps": 5242880,
      "etaSeconds": 25,
      "status": "TRANSFERRING",
      "chunkSize": 1048576,
      "chunksTotal": 256,
      "chunksDone": 128,
      "startedAt": "2026-10-08T10:02:01Z",
      "completedAt": null,
      "error": null
    }
  ]
}
```

`progressPct`, `speedBps`, `etaSeconds`, `chunksDone` come from the live
transfer state; nothing is simulated.

### GET /api/v1/transfers/{id}

Same shape as a transfer entry, plus `"chunkMap": "DONE:128 PENDING:128"` as
an array of chunk states:

```json
{ "transfer": { ... }, "chunks": [ { "index": 0, "size": 1048576, "state": "DONE" } ] }
```

### POST /api/v1/transfers/{id}/pause | /resume | /cancel | /retry

Response: `{ "transfer": { ... } }`

`pause` stops issuing new chunk requests and freezes the transfer state
(persisted, survives restart). `resume` continues from the first pending
chunk. `cancel` moves to `CANCELLED`. `retry` requeues a `FAILED` transfer
from its persisted chunk map.

### GET /api/v1/conflicts

```json
{
  "conflicts": [
    {
      "id": 4,
      "folderId": 1,
      "folderName": "Documents",
      "relPath": "report.pdf",
      "localHash": "aa01...",
      "remoteHash": "ff09...",
      "localSize": 81234,
      "remoteSize": 80999,
      "localMtime": "2026-10-08T07:11:45Z",
      "remoteMtime": "2026-10-08T07:40:02Z",
      "remotePeerId": "31aa...",
      "remotePeerName": "mesh-beta",
      "status": "OPEN",
      "resolution": null,
      "createdAt": "2026-10-08T10:01:22Z",
      "resolvedAt": null
    }
  ]
}
```

### POST /api/v1/conflicts/{id}/resolve

Body: `{ "action": "KEEP_LOCAL" | "KEEP_REMOTE" | "KEEP_BOTH" | "LATER" }`

* `KEEP_LOCAL` — the local version wins; the local content is pushed to the
  peer (its current copy goes to the peer's trash first).
* `KEEP_REMOTE` — the remote version wins; it is pulled over the local copy
  (the local copy goes to the local trash first).
* `KEEP_BOTH` — the remote version is pulled and stored next to the local
  file as `report (conflict from mesh-beta 2026-10-08).pdf`, then the local
  version wins for the original path.
* `LATER` — keeps the conflict open, no data is touched.

Response: `{ "conflict": { ...status RESOLVED... } }`. The resolution runs
an immediate mini sync session; failures return `PEER_OFFLINE` with the
conflict left `OPEN`.

### GET /api/v1/events?sinceEventId=0&limit=100

Newest events last (ascending by id). Shape:

```json
{
  "events": [
    { "id": 512, "type": "TRANSFER_COMPLETED", "severity": "INFO",
      "message": "Pulled videos/demo.mp4 (256 MiB) from mesh-beta at 5.2 MiB/s",
      "data": { "transferId": "t-1f0a...", "relPath": "videos/demo.mp4" },
      "ts": "2026-10-08T10:02:31Z" }
  ]
}
```

### GET /api/v1/events/ws — WebSocket event stream

Upgrade: `GET /api/v1/events/ws` (through the gateway:
`ws(s)://<host>/api/v1/events/ws?XTransformPort=3040`).

Server → client messages (one JSON object per frame):

```json
{ "kind": "hello",   "device": { ...GET /device shape... }, "ts": "..." }
{ "kind": "event",   "event":  { ...event shape... } }
{ "kind": "transfer","transfer": { ...transfer shape... } }
{ "kind": "peers",   "peers": [ ...peer shapes... ] }
{ "kind": "device",  "device": { ... } }
{ "kind": "pong" }
```

Client → server: `{ "kind": "ping" }`. The server sends `transfer` frames on
progress (throttled to ~8/s per transfer) and on any state change, `peers`
frames whenever peer online/trust state changes, and `device` frames when
stats change. Disconnects are expected; clients reconnect with backoff and
refetch state via the REST endpoints (stale WS state is never trusted).

### GET /api/v1/settings — PUT /api/v1/settings

```json
{
  "deviceName": "mesh-alpha",
  "bandwidthLimitBps": 0,
  "concurrentTransfers": 2,
  "chunkSizeBytes": 1048576,
  "discoveryEnabled": true,
  "skipHiddenFiles": false,
  "autoSyncSeconds": 0
}
```

`bandwidthLimitBps` 0 = unlimited. `chunkSizeBytes` allowed range 64 KiB –
16 MiB. `autoSyncSeconds` 0 = manual sync only. PUT returns the stored
settings after validation. The agent persists settings across restarts.

## Security notes

* The API binds to `127.0.0.1` by default (`--api-bind` / `MESHSYNC_API_BIND`
  to change). Exposing it to a LAN requires opting in.
* If an API token is configured (`--api-token` / `MESHSYNC_API_TOKEN`),
  every request must carry `Authorization: Bearer <token>`.
* Peer connections are TLS 1.3 with certificate keys pinned to each device's
  persistent Ed25519 identity; trust is granted only through explicit
  pairing approval. See SECURITY.md.
* All remote paths are validated (no absolute paths, no `..`, no symlink
  escapes) before any filesystem write.
