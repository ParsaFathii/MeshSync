#!/usr/bin/env bash
# validate-release.sh — local pre-release gate.
#
# Runs every check that release CI runs, with guards: a missing tool or a
# component that has not landed yet logs a WARN and is skipped; anything that
# DOES run and fails makes the script exit non-zero at the end.
#
#   * Go agent      — go vet + go test ./...           (agent/)
#   * Native engine — make -C native/cpp test          (only if the Makefile exists)
#   * Web console   — bun install --frozen-lockfile + bun run lint
#   * Flutter       — flutter pub get + analyze + test (only if flutter/ exists)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAILURES=0

ok()   { printf 'OK    %s\n' "$*"; }
warn() { printf 'WARN  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; FAILURES=$((FAILURES + 1)); }

# --- Go agent ---------------------------------------------------------------
run_go() {
    local go_bin=""
    if [ -x /home/z/opt/go/bin/go ]; then
        go_bin=/home/z/opt/go/bin/go
    elif command -v go >/dev/null 2>&1; then
        go_bin="$(command -v go)"
    fi
    if [ -z "$go_bin" ]; then
        warn "no Go toolchain found (checked /home/z/opt/go/bin/go and PATH) — skipping Go checks"
        return 0
    fi
    if [ ! -f "$ROOT/agent/go.mod" ]; then
        warn "agent/go.mod not found — skipping Go checks"
        return 0
    fi
    echo "--- go vet + go test (agent/) with ${go_bin}"
    if (cd "$ROOT/agent" && "$go_bin" vet ./... && "$go_bin" test ./...); then
        ok "go vet + go test (agent/)"
    else
        fail "go vet / go test (agent/)"
    fi
}

# --- Native C++ engine --------------------------------------------------------
run_native() {
    if [ ! -f "$ROOT/native/cpp/Makefile" ]; then
        warn "native/cpp/Makefile not present yet — skipping native engine checks"
        return 0
    fi
    if ! command -v make >/dev/null 2>&1; then
        warn "make not found — skipping native engine checks"
        return 0
    fi
    echo "--- make -C native/cpp test"
    if make -C "$ROOT/native/cpp" test; then
        ok "native engine tests"
    else
        fail "native engine tests"
    fi
}

# --- Web console ---------------------------------------------------------------
run_web() {
    if [ ! -f "$ROOT/package.json" ]; then
        warn "package.json not found — skipping web checks"
        return 0
    fi
    if ! command -v bun >/dev/null 2>&1; then
        warn "bun not found — skipping web checks"
        return 0
    fi
    echo "--- bun install --frozen-lockfile + bun run lint"
    if (cd "$ROOT" && bun install --frozen-lockfile && bun run lint); then
        ok "web console lint"
    else
        fail "web console lint"
    fi
}

# --- Flutter client --------------------------------------------------------------
run_flutter() {
    if [ ! -d "$ROOT/flutter" ]; then
        warn "flutter/ directory not present yet — skipping Flutter checks"
        return 0
    fi
    if ! command -v flutter >/dev/null 2>&1; then
        warn "flutter/ exists but the flutter tool is not on PATH — skipping Flutter checks"
        return 0
    fi
    echo "--- flutter pub get + analyze + test (flutter/)"
    if (cd "$ROOT/flutter" && flutter pub get && flutter analyze && flutter test); then
        ok "flutter analyze + test"
    else
        fail "flutter pub get / analyze / test"
    fi
}

run_go
run_native
run_web
run_flutter

echo
if [ "$FAILURES" -gt 0 ]; then
    echo "validate-release.sh: ${FAILURES} check(s) FAILED."
    exit 1
fi
echo "validate-release.sh: all present checks passed (skipped ones are WARNed above)."
