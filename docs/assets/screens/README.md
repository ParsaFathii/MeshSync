# Web console screenshots & demo GIF

13 PNG screenshots and one animated GIF of the MeshSync web console (v1.0.0),
all captured from the running application during a live two-agent session:
`mesh-alpha` (API 127.0.0.1:3040, peer 4040) and `mesh-beta` (API 3041, peer
4041) as trusted peers over the real peer protocol, with a shared `docs`
folder, real transfers (64 B up to 48 MiB), a deliberately created conflict,
and the C++20 hashing worker active (`cpp-worker-1.0.0`). Nothing is mocked:
every value visible — peer IDs, SHA-256 hashes, byte counts, percentages,
speed graphs, errors — comes from the actual agents.

Capture context: console served through the deployment gateway at
`http://localhost:81/` (gateway → Next.js console → agent REST/WS APIs),
desktop viewport 1440×900 except `10-mobile-fa-rtl.png` at 390×844. The
transfer in `06-transfer-active-en.png` and the GIF ran with a deliberate
3 000 000 B/s bandwidth cap (visible in `13-settings-en.png`) so progress is
observable; production default is unlimited.

| File | What it shows |
| --- | --- |
| `demo-sync.gif` | 46-second animated end-to-end demo: a 44 MiB `demo-archive.tar` is created on mesh-alpha, shows as `PENDING` in Files; the Sync workspace computes the plan (1 PUSH, 2 UNCHANGED); Execute plan starts the transfer; the Transfers workspace shows the live progress bar and throughput graph climbing 34% → 79% → 100%; back in Files everything is `SYNCED`. |
| `01-device-en-light.png` | Device workspace, English, light theme — mesh-alpha identity (v1.0.0, linux/amd64, API 3040 · PEER 4040, native engine `cpp-worker-1.0.0`) and live stats: 1 shared folder, 5 files, 112 MiB indexed, 1 trusted peer online, 1 open conflict, last sync minutes ago. Status pill: LIVE. |
| `02-peers-fa-rtl.png` | Peers workspace, Persian, RTL layout — the two-node mesh view (mesh-alpha + mesh-beta) and the trusted-peer card for mesh-beta (TRUSTED, online, v1.0.0) with actions (revoke, copy address, remove). |
| `03-folders-en-light.png` | Folders workspace, English, light theme — the shared `docs` folder (4 files, 92 MiB at capture time) with its index state and rescan action. |
| `04-files-en-light.png` | Files workspace, English, light theme — the file browser for `docs` with `notes.md` selected (174 B, PENDING/LOCAL_ONLY): detail panel shows the truncated SHA-256 content hash and the 1/1 chunk map computed by the native worker. |
| `05-sync-plan-en.png` | Sync workspace, English, light theme — a computed plan against mesh-beta for `docs`: summary TOTAL 4 · PUSH 1 · CONFLICT 1 · UNCHANGED 2, with the action table (notes.md → PUSH, hello.txt → CONFLICT) and the session history of previous completed syncs. |
| `06-transfer-active-en.png` | Transfers workspace, English, light theme — an in-flight transfer: `media-backup.zip` at 85% with progress bar, live speed graph, and the four previously completed transfers below. Status pill: LIVE. |
| `07-transfers-history-en.png` | Transfers workspace, English, light theme — completed history, 5 transfers at 100%: hello.txt (64 B), demo-dataset.bin (48 MiB), demo-archive.tar (44 MiB), notes.md, media-backup.zip — each with peer, direction, timing and chunk counts. |
| `08-conflict-open-en.png` | Conflicts workspace, English, light theme — an open conflict on `hello.txt` (edited on both agents at once): local 71 B vs remote 79 B (8 B difference), truncated SHA-256 for both sides, and the resolution options. |
| `09-activity-fa.png` | Activity workspace, Persian, RTL layout — the live event stream over WebSocket: pairing/trust events, transfer progress (media-backup.zip at 99%) and sync-session events, newest first. |
| `10-mobile-fa-rtl.png` | Mobile viewport (390×844), Persian, RTL — the Folders workspace on a phone-width layout: `docs` with 5 files / 112 MiB, workspace navigation collapsed into the top area. |
| `11-device-dark-en.png` | Device workspace, English, dark theme — the same mesh-alpha identity and live-stat view in dark mode. |
| `12-error-recovery-en.png` | Error/recovery state, English — mesh-beta was deliberately stopped: the reconnect banner ("Agent unreachable at port 3041 — reconnecting…"), RECONNECTING status pill, and the red unreachable panel in Folders. The in-server supervisor re-spawned the agent seconds later and the console reconnected on its own. |
| `13-settings-en.png` | Settings workspace, English, light theme — live editable agent settings: device name, discovery, hidden-file policy, chunk size, concurrency and the bandwidth cap (2930 KiB/s) applied during capture. |
