#!/usr/bin/env bash
# build-all.sh — build every MeshSync component that exists locally.
#
#   * Go agent     -> agent/bin/meshsync-agent  (static: CGO_ENABLED=0,
#                      -trimpath -ldflags "-s -w")
#   * Native worker-> native/cpp/bin/meshsync-native (via make -C native/cpp;
#                      skipped with a warning while the engine has not landed)
#
# The Go toolchain is resolved as /home/z/opt/go/bin/go when present (sandbox
# location), otherwise `go` from PATH (portable machines / CI).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# --- toolchain resolution ------------------------------------------------
GO_BIN=""
if [ -x /home/z/opt/go/bin/go ]; then
    GO_BIN=/home/z/opt/go/bin/go
elif command -v go >/dev/null 2>&1; then
    GO_BIN="$(command -v go)"
else
    cat >&2 <<'EOF'
build-all.sh: no Go toolchain found.
Looked for: /home/z/opt/go/bin/go, then `go` in PATH.
Install Go (https://go.dev/dl/) or set it up and re-run.
EOF
    exit 1
fi
echo "Using Go: ${GO_BIN} ($("${GO_BIN}" version))"

ARTIFACTS=()

# --- Go agent --------------------------------------------------------------
if [ -f "$ROOT/agent/go.mod" ]; then
    echo "==> Building meshsync-agent (agent/)..."
    mkdir -p "$ROOT/agent/bin"
    (
        cd "$ROOT/agent"
        CGO_ENABLED=0 "$GO_BIN" build -trimpath -ldflags="-s -w" \
            -o bin/meshsync-agent ./cmd/meshsync-agent
    )
    ARTIFACTS+=("$ROOT/agent/bin/meshsync-agent")
    "$ROOT/agent/bin/meshsync-agent" --version || true
else
    echo "WARN: agent/go.mod not found — skipping agent build." >&2
fi

# --- Native C++ hashing worker ---------------------------------------------
if [ -f "$ROOT/native/cpp/Makefile" ]; then
    echo "==> Building native hashing worker (make -C native/cpp)..."
    make -C "$ROOT/native/cpp" all
    if [ -f "$ROOT/native/cpp/bin/meshsync-native" ]; then
        ARTIFACTS+=("$ROOT/native/cpp/bin/meshsync-native")
    elif [ -f "$ROOT/native/cpp/meshsync-native" ]; then
        ARTIFACTS+=("$ROOT/native/cpp/meshsync-native")
    else
        echo "WARN: make finished but meshsync-native binary not found." >&2
    fi
else
    echo "WARN: native/cpp/Makefile not present yet — skipping native worker (engine still landing)." >&2
fi

# --- summary ----------------------------------------------------------------
if [ "${#ARTIFACTS[@]}" -eq 0 ]; then
    echo "build-all.sh: nothing was built." >&2
    exit 1
fi

echo
echo "Artifacts:"
for f in "${ARTIFACTS[@]}"; do
    size="$(ls -lh "$f" | awk '{print $5}')"
    printf '  %-55s %s\n' "$f" "$size"
done
