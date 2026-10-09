#!/usr/bin/env bash
# demo-sync.sh — end-to-end local MeshSync sync demo (real agent, real API).
#
# Flow (all endpoints per docs/API.md):
#   1. Ensure both agents are healthy (starts them via scripts/run-agents.sh
#      if needed — that script is idempotent).
#   2. Pair mesh-alpha -> mesh-beta if they are not trusted yet:
#      POST /api/v1/peers/pair on A, POST /api/v1/peers/{id}/approve on B.
#   3. Create demo folders .runtime/demo-a and .runtime/demo-b and register
#      them as a shared folder with the SAME name "Demo" on both agents.
#   4. Write two sample files on A through the API (POST /api/v1/files).
#   5. Run a sync session (POST /api/v1/sync/run on A) and poll
#      GET /api/v1/sync/sessions until it completes.
#   6. Verify the files landed on B byte-for-byte (sha256 comparison).
#
# Prints PASS or FAIL; exits non-zero on FAIL.
#
# Requires: curl, jq, sha256sum. Agents are NOT stopped at the end (stop with
# scripts/run-agents.sh --stop).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME="$ROOT/.runtime"

A_API="http://127.0.0.1:3040"
B_API="http://127.0.0.1:3041"
A_NAME="mesh-alpha"
B_NAME="mesh-beta"
B_PEER_ADDR="127.0.0.1:4041"
A_PEER_ADDR="127.0.0.1:4040"
FOLDER_NAME="Demo"
DIR_A="$RUNTIME/demo-a"
DIR_B="$RUNTIME/demo-b"

for tool in curl jq sha256sum; do
    command -v "$tool" >/dev/null 2>&1 || { echo "demo-sync.sh: $tool is required" >&2; exit 1; }
done

die() { echo "demo-sync.sh: FAIL — $*" >&2; exit 1; }

# api METHOD URL [JSON_BODY] — prints the response body; dies on non-2xx.
api() {
    local method="$1" url="$2" body="${3:-}" tmp code
    tmp="$(mktemp)"
    if [ -n "$body" ]; then
        code="$(curl -sS -o "$tmp" -w '%{http_code}' -X "$method" \
            -H 'Content-Type: application/json' -d "$body" "$url")" || { rm -f "$tmp"; die "curl error on $method $url"; }
    else
        code="$(curl -sS -o "$tmp" -w '%{http_code}' -X "$method" "$url")" || { rm -f "$tmp"; die "curl error on $method $url"; }
    fi
    if [ "$code" -lt 200 ] || [ "$code" -ge 300 ]; then
        echo "demo-sync.sh: HTTP $code from $method $url:" >&2
        cat "$tmp" >&2 || true
        echo >&2
        rm -f "$tmp"
        die "unexpected status $code"
    fi
    cat "$tmp"
    rm -f "$tmp"
}

wait_url() {
    # wait_url URL NAME SECONDS
    local url="$1" name="$2" deadline="$3" waited=0
    while ! curl -fsS --max-time 2 "$url" >/dev/null 2>&1; do
        [ "$waited" -ge "$deadline" ] && die "$name did not become healthy at $url"
        sleep 1
        waited=$((waited + 1))
    done
}

# --- 1. agents up --------------------------------------------------------------
for base in "$A_API" "$B_API"; do
    curl -fsS --max-time 2 "$base/api/v1/health" >/dev/null 2>&1 || {
        echo "demo-sync.sh: agent at $base not healthy — starting agents..."
        "$ROOT/scripts/run-agents.sh"
        break
    }
done
wait_url "$A_API/api/v1/health" "$A_NAME" 30
wait_url "$B_API/api/v1/health" "$B_NAME" 30
echo "[1] agents healthy: $A_NAME ($A_API), $B_NAME ($B_API)"

# --- 2. pairing -----------------------------------------------------------------
trusted_peer_id() {
    api GET "$A_API/api/v1/peers" | jq -r --arg addr "$B_PEER_ADDR" \
        '.peers[]? | select(.address == $addr and .trust == "TRUSTED") | .peerId' | head -n1
}

peer_id_of_a_on_b() {
    api GET "$B_API/api/v1/peers" | jq -r --arg addr "$A_PEER_ADDR" \
        '.peers[]? | select(.address == $addr) | .peerId' | head -n1
}

B_PEER_ID="$(trusted_peer_id || true)"
if [ -n "$B_PEER_ID" ]; then
    echo "[2] peers already trusted (${B_PEER_ID})"
else
    echo "[2] pairing $A_NAME -> $B_NAME ($B_PEER_ADDR)..."
    api POST "$A_API/api/v1/peers/pair" "$(jq -nc --arg a "$B_PEER_ADDR" '{address: $a}')"
    sleep 1
    # B sees the request as a PAIRING peer; approve it there.
    pairing_id="$(api GET "$B_API/api/v1/peers" | jq -r '[.peers[]? | select(.trust == "PAIRING")][0].peerId // ""')"
    [ -n "$pairing_id" ] || die "no PAIRING peer visible on $B_NAME after pair request"
    api POST "$B_API/api/v1/peers/${pairing_id}/approve" '{}' >/dev/null
    # Both sides converge to TRUSTED — poll for it.
    for _ in $(seq 1 10); do
        B_PEER_ID="$(trusted_peer_id || true)"
        [ -n "$B_PEER_ID" ] && break
        sleep 1
    done
    [ -n "$B_PEER_ID" ] || die "peers never reached TRUSTED state"
    echo "    trusted: $B_PEER_ID"
fi

# --- 3. shared folders ------------------------------------------------------------
mkdir -p "$DIR_A" "$DIR_B"

folder_id() {
    local base="$1" path="$2"
    api GET "$base/api/v1/shared-folders" | jq -r --arg name "$FOLDER_NAME" --arg path "$path" \
        '.folders[]? | select(.name == $name and .path == $path) | .id' | head -n1
}

ensure_folder() {
    local base="$1" path="$2" id
    id="$(folder_id "$base" "$path")"
    if [ -n "$id" ]; then
        echo "$id"
        return 0
    fi
    api POST "$base/api/v1/shared-folders" "$(jq -nc --arg name "$FOLDER_NAME" --arg path "$path" '{name: $name, path: $path}')" \
        | jq -r '.folder.id'
}

A_FOLDER_ID="$(ensure_folder "$A_API" "$DIR_A")"
B_FOLDER_ID="$(ensure_folder "$B_API" "$DIR_B")"
[ -n "$A_FOLDER_ID" ] || die "could not register folder on $A_NAME"
[ -n "$B_FOLDER_ID" ] || die "could not register folder on $B_NAME"
echo "[3] shared folders registered (name '$FOLDER_NAME'): A id=$A_FOLDER_ID ($DIR_A), B id=$B_FOLDER_ID ($DIR_B)"

# --- 4. sample files on A ----------------------------------------------------------
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
hello_content="MeshSync demo file (hello.txt)
written by scripts/demo-sync.sh at ${ts}
source: $A_NAME -> $B_NAME
"
notes_content="MeshSync demo notes (notes/readme.md)
run at ${ts}
If you can read this on both sides, chunked transfer + hashing worked.
"

write_file() {
    local path="$1" content="$2"
    api POST "$A_API/api/v1/files" \
        "$(jq -nc --argjson folder "$A_FOLDER_ID" --arg path "$path" --arg content "$content" \
            '{folder: $folder, path: $path, content: $content, encoding: "utf8"}')" >/dev/null
}

write_file "hello.txt" "$hello_content"
write_file "notes/readme.md" "$notes_content"
echo "[4] wrote 2 sample files on $A_NAME via POST /api/v1/files (hello.txt, notes/readme.md)"

# --- 5. sync -----------------------------------------------------------------------
echo "[5] running sync on $A_NAME (folder '$FOLDER_NAME', peer $B_PEER_ID)..."
session_id="$(api POST "$A_API/api/v1/sync/run" \
    "$(jq -nc --arg peer "$B_PEER_ID" --argjson folder "$A_FOLDER_ID" '{peer: $peer, folder: $folder}')" \
    | jq -r '.sessionId')"
[ -n "$session_id" ] || die "no sessionId returned from sync/run"
echo "    session: $session_id"

session_status() {
    api GET "$A_API/api/v1/sync/sessions" | jq -r --arg id "$session_id" \
        '[.sessions[]? | select(.id == $id)][0] | .status // "PENDING"'
}

status="PENDING"
for _ in $(seq 1 60); do
    status="$(session_status || echo PENDING)"
    case "$status" in
        COMPLETED | FAILED | CANCELLED) break ;;
    esac
    sleep 2
done
case "$status" in
    COMPLETED) ;;
    *) die "sync session $session_id ended in status $status (expected COMPLETED)" ;;
esac
session_json="$(api GET "$A_API/api/v1/sync/sessions" | jq -c --arg id "$session_id" '[.sessions[]? | select(.id == $id)][0]')"
echo "    session completed: $session_json"

# --- 6. verification -------------------------------------------------------------------
verify_file() {
    local rel="$1" ha hb
    ha="$(sha256sum "$DIR_A/$rel" | cut -d' ' -f1)"
    if [ ! -f "$DIR_B/$rel" ]; then
        echo "    MISSING on B: $rel" >&2
        return 1
    fi
    hb="$(sha256sum "$DIR_B/$rel" | cut -d' ' -f1)"
    if [ "$ha" = "$hb" ]; then
        echo "    OK  $rel  sha256=${ha:0:16}… (both sides identical)"
        return 0
    fi
    echo "    MISMATCH $rel: A=${ha:0:16}… B=${hb:0:16}…" >&2
    return 1
}

echo "[6] verifying transferred files (sha256 A vs B):"
result=0
verify_file "hello.txt" || result=1
verify_file "notes/readme.md" || result=1

echo
if [ "$result" -eq 0 ]; then
    echo "PASS — end-to-end sync verified ($A_NAME -> $B_NAME, session $session_id)."
    exit 0
fi
echo "FAIL — see mismatches above."
exit 1
