#!/usr/bin/env bash
# gen-checksums.sh — generate and verify SHA256SUMS files.
#
# Usage:
#   scripts/gen-checksums.sh FILE [FILE...] > SHA256SUMS
#       Emits one "<sha256>  <basename>" line per file (compatible with
#       `sha256sum -c`). Every file is hashed twice (two independent reads);
#       the script fails if the digests disagree, guarding against files
#       that change while the checksums are being generated.
#   scripts/gen-checksums.sh --check SHA256SUMS
#       Verifies a checksum file in place (runs `sha256sum -c`).
set -euo pipefail

usage() {
    sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

if [ "${1:-}" = "--check" ]; then
    [ $# -eq 2 ] || { echo "gen-checksums.sh: --check takes exactly one file" >&2; exit 2; }
    sumfile="$2"
    [ -f "$sumfile" ] || { echo "gen-checksums.sh: no such file: $sumfile" >&2; exit 1; }
    # sha256sum -c resolves names relative to the checksum file's directory.
    cd "$(dirname "$sumfile")"
    exec sha256sum -c "$(basename "$sumfile")"
fi

[ $# -ge 1 ] || { usage >&2; exit 2; }
if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
    usage
    exit 0
fi

for f in "$@"; do
    if [ ! -f "$f" ]; then
        echo "gen-checksums.sh: not a regular file: $f" >&2
        exit 1
    fi
    h1="$(sha256sum "$f" | cut -d' ' -f1)"
    h2="$(sha256sum "$f" | cut -d' ' -f1)"
    if [ "$h1" != "$h2" ]; then
        echo "gen-checksums.sh: file changed while hashing: $f" >&2
        exit 1
    fi
    printf '%s  %s\n' "$h1" "$(basename "$f")"
done
