# MeshSync Security

This document describes what MeshSync actually does to protect data and
devices, and what it deliberately does not attempt. It is written against the
implementation in `agent/` — every claim below traces to code.

Trust lifecycle diagram: [docs/assets/peer-lifecycle.svg](docs/assets/peer-lifecycle.svg).

## Identity and trust model

- Every agent generates a persistent **Ed25519** key pair on first start,
  stored raw at `~/.meshsync/identity.key` with `0600` permissions. The peer
  ID is the first 8 bytes of SHA-256(public key), hex-encoded (16 chars), so
  it is stable across restarts and computationally unbindable from the key.
  `GET /api/v1/device` exposes a human-checkable fingerprint
  (`SHA256:…`, base64 of the full digest).
- Trust states: `DISCOVERED` → `PAIRING` → `TRUSTED`, with `REVOKED` as the
  refuse-all state. Only `TRUSTED` peers may exchange manifests, chunks, or
  deletion requests; the server enforces this after the handshake for every
  non-pairing message.
- **Discovery never grants trust.** UDP beacons only *record* peers as
  `DISCOVERED`. Trust requires an explicit `POST /peers/{id}/approve` on the
  receiving device.
- Pairing is a two-sided handshake: the initiator sends `PAIR_REQUEST`, the
  remote records `PAIRING` and decides. Approval sends `PAIR_APPROVED`, which
  flips the initiator's record to `TRUSTED` as well. Nothing auto-approves.
- **Key pinning.** After pairing, the peer's Ed25519 public key is stored in
  the database. On every later connection the key presented in the handshake
  must equal the pinned key, otherwise the connection is dropped with an
  `IDENTITY_MISMATCH` wire error. A peer that regenerated its identity must
  be removed and re-paired explicitly.

### Revoking a peer

`POST /api/v1/peers/{peerId}/revoke` moves the peer to `REVOKED`:

- The peer's connections are dropped and its online state cleared.
- Future TLS handshakes from that peer are refused with a `REVOKED` wire
  error before any protocol message is processed.
- New pairing attempts from that peer are rejected
  (`PAIR_REJECTED`) until you `DELETE /api/v1/peers/{peerId}` to remove the
  record entirely.

Note that revocation is enforced by the refusing device; the revoked peer
still holds copies of previously synced files (delete them there if needed).

## Transport security (`agent/internal/netproto/tls.go`)

Peer connections are **TLS 1.3** over TCP with self-signed certificates:

- The only accepted certificate key material is the device's Ed25519 identity
  key: the certificate is self-signed, and the self-signature is verified
  (Ed25519 over `RawTBSCertificate`). A CA-signed or foreign-key certificate
  fails the handshake.
- Completing the handshake *is* the identity proof: whoever finishes it
  owns the private key matching the pinned public key.
- The server side accepts any self-signed Ed25519 certificate during the
  handshake and makes trust decisions *after* it by extracting the peer ID
  and comparing the key to the pinned one (`PeerIdentityFromCert`).
- The client side pins the expected public key in
  `VerifyPeerCertificate` — a key mismatch aborts the handshake
  ("peer key does not match pinned identity"). The single exception is the
  initial pairing dial, where the key is intentionally unknown so it can be
  learned and shown to the user for approval.
- The HELLO message must repeat the certificate's peer ID; a mismatch
  (`IDENTITY_MISMATCH`) closes the connection.
- Wire framing enforces a 17 MiB maximum frame size (16 MiB chunk + header
  room); malformed lengths are rejected before any allocation.
- Handshake deadlines: 15 s server-side, 10 s client dial; idle read deadline
  90 s. These bound the cost of slow/malicious connection attempts.

## API security (`agent/internal/api/api.go`)

- **Localhost by default.** The HTTP API binds `127.0.0.1:3040` unless
  `--api-bind` / `MESHSYNC_API_BIND` changes it. Exposing the API to a LAN is
  an explicit opt-in; combine it with a token.
- **Optional Bearer token.** With `--api-token` / `MESHSYNC_API_TOKEN` set,
  every request (including the WebSocket upgrade) must carry
  `Authorization: Bearer <token>`; otherwise the middleware returns `401
  UNAUTHORIZED`.
- **Rate limiting.** 600 requests per 10 seconds per source IP; beyond that
  the API answers `429 RATE_LIMITED`. Enough for a dashboard, tight against
  runaway loops.
- **Input limits.** JSON bodies are capped at 1 MiB;
  `ReadHeaderTimeout` is 10 s. Transfer chunk requests/headers are
  validated (positive length ≤ 16 MiB, non-negative offset, declared length
  must equal the delivered data).
- **Validation.** All endpoints validate shapes before acting: pairing
  addresses must be `host:port`; folder paths must be existing absolute
  directories; settings are range-checked (chunk size 64 KiB–16 MiB,
  concurrency 1–8, device name ≤ 64 chars); sync runs require a `TRUSTED`
  and reachable peer.
- **CORS.** `Access-Control-Allow-Origin: *` with the standard
  methods/headers, and the WS upgrader accepts any origin. This is safe in
  the default localhost deployment and is what lets the web console (served
  from a different port/gateway origin) drive the agent. **If you bind the
  API to a LAN interface, set a token** — otherwise any web page you visit
  could reach the unauthenticated API from a browser on that LAN. Origin
  allow-lists are a deliberate non-goal for the local-agent deployment
  model.

## Filesystem protections

- **Path validation (`indexer.SafeJoin`).** Every remote-supplied path —
  chunk requests, deletions, conflict resolutions — is resolved inside the
  shared folder root and rejected on: absolute paths, `..` segments
  (checked segment-by-segment *and* via lexical cleaning), empty paths,
  backslashes, NUL bytes, and any final result that escapes the root.
- **Symlink policy.** Only regular files are indexed, transferred, or
  received; symlinks, directories-as-files, sockets and device nodes are
  never hashed or synced. A symlink can therefore not redirect writes outside
  the folder.
- **Delete safety.** A remote `DELETE_FILE` is applied only when our current
  content still hashes to the `expectedHash` the sender planned to delete;
  otherwise the deletion is refused and the path becomes a conflict. Nothing
  is ever deleted "because a message said so".
- **Integrity.** Every chunk is SHA-256-verified on arrival; the assembled
  file is fully re-hashed before the atomic rename into the shared folder;
  corrupt part files are discarded so a retry starts clean.
- **Trash.** Deletions and conflict overwrites move the losing copy to
  `~/.meshsync/trash/<folder>/` with timestamped names before any write.
- Part files (`~/.meshsync/parts/`) live outside shared folders, so partial
  data never appears at destination paths.

## Threats and mitigations

| Threat | Mitigation in code |
|---|---|
| MITM on peer connections | TLS 1.3; certificate key = pinned Ed25519 identity; self-signature verified; key mismatch aborts handshake |
| Unauthorized peers / rogue agent on LAN | Explicit pairing approval; sync traffic requires `TRUSTED`; `REVOKED` peers refused at handshake |
| Identity spoofing (peer ID reuse) | ID derived from the pinned public key; HELLO must match the certificate identity; changed key → `IDENTITY_MISMATCH` |
| Tampered files in transit | Per-chunk SHA-256 + full-file verification before rename; failures discard the part file |
| Tampered files at rest | Hashes are recomputed on scan; a local file that no longer matches its planned hash aborts its transfer ("never push surprises") |
| Replay of old messages | TLS 1.3 record protection on the connection; deletion requests carry the expected content hash, so an old delete cannot clobber diverged data; transfers are anchored to the planned hash |
| Malformed / hostile frames | 17 MiB frame cap; strict decode paths; handshake/read deadlines; JSON body cap; per-IP rate limit |
| Path traversal / symlink escapes | `SafeJoin` validation on every remote path; regular-files-only policy; writes confined to folder roots and the state dir |
| Runaway local client | 600 req/10 s per IP → `429`; throttled progress events; slow WS subscribers drop frames instead of blocking the agent |
| Untrusted local users on the machine | State dir and identity key are `0600`/`0700`; API binds localhost by default; optional Bearer token |

## Safe defaults checklist

- API binds `127.0.0.1` — changed only by explicit flag/env.
- No API token by default (local single-user assumption); add one before any
  non-localhost bind.
- Discovery on, but records only (`DISCOVERED`), never trusts.
- Bandwidth unlimited (`0`), concurrency 2, chunk 1 MiB.
- Manual sync only (`autoSyncSeconds = 0`) until configured otherwise.

## Not covered (explicit scope limits)

- **LAN-only scope.** No relay, no NAT traversal, no certificate transparency
  or revocation infrastructure. Security of the TLS layer rests on key
  pinning, not on web PKI.
- **No encryption at rest.** Files, SQLite state, and the trash are plaintext
  on each device; protect them with full-disk encryption if needed.
- **Single-user model.** Anyone with local access to the API (or a trusted
  peer) can read/modify everything shared. There are no per-user accounts,
  ACLs, or audit signatures.
- **Token comparison is a plain string compare** and the token travels in a
  header on every request; treat it like a password, not like a bearer
  credential for hostile networks.
- The Bearer check applies before the WS upgrade, but WS clients that
  already hold the token keep it in query-string-less headers only — still,
  tokens in shell history or logs are a real risk; rotate if leaked.
- **Revoked peers keep their data.** Revocation stops future exchange; it
  cannot remotely delete or lock the other device's copies.
- No protection against a *compromised trusted device* — trust in MeshSync
  means full read/write to the shared folders, by design.
