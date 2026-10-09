#!/usr/bin/env bash
# run-agents.sh — start (or stop) two local MeshSync agents for development.
#
#   agent A "mesh-alpha": data .runtime/agent-a   API 3040   peer 4040
#   agent B "mesh-beta":  data .runtime/agent-b   API 3041   peer 4041
#
# Idempotent: an agent whose health endpoint already answers is left alone
# (whoever owns the port keeps running it — this also makes the script safe
# while other harnesses use the same ports).
#
# Usage:
#   scripts/run-agents.sh [--native-path PATH]   # start both (default)
#   scripts/run-agents.sh --stop                 # stop both via PID files
#
# Logs and PID files live under .runtime/. The native worker flag defaults
# to native/cpp/bin/meshsync-native when that file exists, otherwise the
# flag is omitted (agent uses pure-Go hashing fallback).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME="$ROOT/.runtime"

API_A=3040
PEER_A=4040
NAME_A=mesh-alpha
API_B=3041
PEER_B=4041
NAME_B=mesh-beta

STOP=0
NATIVE_PATH=""

usage() {
    sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
    case "$1" in
        --stop)
            STOP=1
            ;;
        --native-path)
            [ $# -ge 2 ] || { echo "run-agents.sh: --native-path requires a value" >&2; exit 2; }
            NATIVE_PATH="$2"
            shift
            ;;
        -h | --help)
            usage
            exit 0
            ;;
        *)
            echo "run-agents.sh: unknown argument: $1" >&2
            usage >&2
            exit 2
            ;;
    esac
    shift
done

# Locate the agent binary (scripts/build-all.sh writes agent/bin/).
AGENT_BIN=""
for candidate in "$ROOT/agent/bin/meshsync-agent" "$ROOT/agent/meshsync-agent"; do
    if [ -x "$candidate" ]; then
        AGENT_BIN="$candidate"
        break
    fi
done

health_ok() {
    curl -fsS --max-time 2 "http://127.0.0.1:${1}/api/v1/health" >/dev/null 2>&1
}

wait_health() {
    local port="$1" name="$2" peer="$3" log="$4"
    local tries=60 # 60 x 0.5s = 30s
    while [ "$tries" -gt 0 ]; do
        if health_ok "$port"; then
            echo "  ${name}: healthy on http://127.0.0.1:${port} (peer ${peer})"
            return 0
        fi
        sleep 0.5
        tries=$((tries - 1))
    done
    echo "run-agents.sh: ${name} did not become healthy; last log lines:" >&2
    tail -n 20 "$log" >&2 || true
    return 1
}

stop_one() {
    local name="$1" pidfile="$2"
    if [ -f "$pidfile" ]; then
        local pid
        pid="$(cat "$pidfile")"
        if kill -0 "$pid" 2>/dev/null; then
            echo "Stopping ${name} (pid ${pid})..."
            kill "$pid" 2>/dev/null || true
            local n=10
            while kill -0 "$pid" 2>/dev/null && [ "$n" -gt 0 ]; do
                sleep 0.5
                n=$((n - 1))
            done
            kill -9 "$pid" 2>/dev/null || true
        else
            echo "${name}: stale PID file (pid ${pid} not running)."
        fi
        rm -f "$pidfile"
    else
        echo "${name}: no PID file — not started by this script."
    fi
}

start_one() {
    local name="$1" api="$2" peer="$3" data="$4" log="$5" pidfile="$6"
    shift 6
    # Extra args (native path) come through "$@".
    if health_ok "$api"; then
        echo "${name}: already healthy on http://127.0.0.1:${api} — skipping start."
        return 0
    fi
    if [ -f "$pidfile" ]; then
        echo "${name}: stale PID file found (process not healthy) — removing." >&2
        rm -f "$pidfile"
    fi
    mkdir -p "$data"
    echo "Starting ${name}: data ${data}  API ${api}  peer ${peer}"
    nohup "$AGENT_BIN" \
        --data-dir "$data" \
        --api-port "$api" \
        --peer-port "$peer" \
        --name "$name" \
        "$@" \
        >"$log" 2>&1 &
    echo $! >"$pidfile"
}

if [ "$STOP" -eq 1 ]; then
    stop_one "$NAME_A" "$RUNTIME/agent-a.pid"
    stop_one "$NAME_B" "$RUNTIME/agent-b.pid"
    exit 0
fi

if [ -z "$AGENT_BIN" ]; then
    cat >&2 <<EOF
run-agents.sh: meshsync-agent binary not found.
Looked for:
  agent/bin/meshsync-agent
  agent/meshsync-agent
Build it first: scripts/build-all.sh
EOF
    exit 1
fi

# Resolve the native worker path.
NATIVE_ARGS=()
if [ -n "$NATIVE_PATH" ]; then
    if [ ! -x "$NATIVE_PATH" ]; then
        echo "run-agents.sh: --native-path ${NATIVE_PATH} is not executable" >&2
        exit 1
    fi
    NATIVE_ARGS=(--native-path "$NATIVE_PATH")
elif [ -x "$ROOT/native/cpp/bin/meshsync-native" ]; then
    NATIVE_ARGS=(--native-path "$ROOT/native/cpp/bin/meshsync-native")
    echo "Using native worker: $ROOT/native/cpp/bin/meshsync-native"
else
    echo "No native worker found (native/cpp/bin/meshsync-native) — agents will use pure-Go hashing."
fi

mkdir -p "$RUNTIME"

start_one "$NAME_A" "$API_A" "$PEER_A" "$RUNTIME/agent-a" "$RUNTIME/agent-a.log" "$RUNTIME/agent-a.pid" ${NATIVE_ARGS[@]+"${NATIVE_ARGS[@]}"}
start_one "$NAME_B" "$API_B" "$PEER_B" "$RUNTIME/agent-b" "$RUNTIME/agent-b.log" "$RUNTIME/agent-b.pid" ${NATIVE_ARGS[@]+"${NATIVE_ARGS[@]}"}

wait_health "$API_A" "$NAME_A" "$PEER_A" "$RUNTIME/agent-a.log"
wait_health "$API_B" "$NAME_B" "$PEER_B" "$RUNTIME/agent-b.log"

echo "Both agents are up."
echo "  mesh-alpha: http://127.0.0.1:${API_A}  peer ${PEER_A}  (${RUNTIME/agent-a})"
echo "  mesh-beta : http://127.0.0.1:${API_B}  peer ${PEER_B}  (${RUNTIME/agent-b})"
echo "Stop with: scripts/run-agents.sh --stop"
