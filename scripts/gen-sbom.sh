#!/usr/bin/env bash
# gen-sbom.sh — generate a CycloneDX 1.5 JSON SBOM from real manifests.
#
# Components come ONLY from what is actually declared in the repository:
#   * agent/go.mod  — Go modules (direct + indirect, with versions)
#   * package.json  — npm packages (dependencies + devDependencies)
#
# Nothing is invented: no network calls, no guessed versions. npm versions
# are the base versions of the declared ranges (e.g. "^5.82.0" -> "5.82.0");
# the raw range is preserved as a component property.
#
# Output: stdout (default) or a file given as the first argument.
# Requires: jq, sha256sum (for a deterministic fallback serial number).
#
# Usage:
#   scripts/gen-sbom.sh                    # SBOM JSON on stdout
#   scripts/gen-sbom.sh meshsync-sbom.json # write to file
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

command -v jq >/dev/null 2>&1 || { echo "gen-sbom.sh: jq is required" >&2; exit 1; }
[ -f "$ROOT/agent/go.mod" ] || { echo "gen-sbom.sh: agent/go.mod not found" >&2; exit 1; }
[ -f "$ROOT/package.json" ] || { echo "gen-sbom.sh: package.json not found" >&2; exit 1; }

OUT="${1:-}"
[ -z "$OUT" ] || [ "$OUT" = "-" ] || shift || true
if [ $# -gt 0 ]; then
    echo "gen-sbom.sh: unexpected extra arguments: $*" >&2
    exit 2
fi

# --- facts from the manifests ----------------------------------------------
go_module="$(awk '/^[[:space:]]*module[[:space:]]+/{print $2; exit}' "$ROOT/agent/go.mod")"
go_toolchain="$(awk '/^[[:space:]]*go[[:space:]]+/{print $2; exit}' "$ROOT/agent/go.mod")"
pkg_name="$(jq -r '.name' "$ROOT/package.json")"

app_version=""
if [ -f "$ROOT/agent/internal/version/version.go" ]; then
    app_version="$(sed -n 's/.*Version[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' \
        "$ROOT/agent/internal/version/version.go" | head -n1)"
fi
[ -n "$app_version" ] || app_version="unparsed"

# --- Go modules (TSV: name <TAB> version <TAB> direct|indirect) --------------
go_tsv="$(awk '
    /^[[:space:]]*require[[:space:]]*\(/ { inreq = 1; next }
    inreq && /^[[:space:]]*\)/ { inreq = 0; next }
    inreq {
        line = $0
        sub(/\/\/.*$/, "", line)
        if (line !~ /[[:alnum:]]/) next
        n = split(line, f, /[[:space:]]+/)
        name = ""; ver = ""
        for (i = 1; i <= n; i++) {
            if (f[i] == "") continue
            if (name == "") { name = f[i]; continue }
            if (ver == "") { ver = f[i]; break }
        }
        if (name == "" || ver == "") next
        scope = ($0 ~ /\/\/[[:space:]]*indirect/) ? "indirect" : "direct"
        printf "%s\t%s\t%s\n", name, ver, scope
    }
    !inreq && /^[[:space:]]*require[[:space:]]+[^({]/ {
        line = $0
        sub(/^[[:space:]]*require[[:space:]]+/, "", line)
        sub(/\/\/.*$/, "", line)
        n = split(line, f, /[[:space:]]+/)
        name = ""; ver = ""
        for (i = 1; i <= n; i++) {
            if (f[i] == "") continue
            if (name == "") { name = f[i]; continue }
            if (ver == "") { ver = f[i]; break }
        }
        if (name == "" || ver == "") next
        scope = ($0 ~ /\/\/[[:space:]]*indirect/) ? "indirect" : "direct"
        printf "%s\t%s\t%s\n", name, ver, scope
    }
' "$ROOT/agent/go.mod")"

# --- npm packages (TSV: name <TAB> declaredRange <TAB> runtime|dev) -----------
npm_tsv="$(jq -r '
    [ (.dependencies // {} | to_entries[] | [.key, .value, "runtime"]),
      (.devDependencies // {} | to_entries[] | [.key, .value, "dev"]) ]
    | .[] | @tsv
' "$ROOT/package.json")"

# --- component arrays --------------------------------------------------------
go_components="$(printf '%s\n' "$go_tsv" | jq -Rn '
    [ inputs | select(length > 0) | split("\t") as $f |
      {
        "type": "library",
        "name": $f[0],
        "version": $f[1],
        "purl": ("pkg:golang/" + $f[0] + "@" + $f[1]),
        "scope": "required",
        "properties": [
          { "name": "meshsync:ecosystem", "value": "gomod" },
          { "name": "meshsync:dependencyScope", "value": $f[2] }
        ]
      } ]
')"

npm_components="$(printf '%s\n' "$npm_tsv" | jq -Rn '
    [ inputs | select(length > 0) | split("\t") as $f |
      ($f[1] | gsub("^[\\^~>=<[:space:]]+"; "") | if . == "" then "unspecified" else . end) as $ver |
      {
        "type": "library",
        "name": $f[0],
        "version": $ver,
        "purl": ("pkg:npm/" + ($f[0] | if startswith("@") then sub("^@"; "%40") else . end) + "@" + $ver),
        "scope": (if $f[2] == "dev" then "optional" else "required" end),
        "properties": [
          { "name": "meshsync:ecosystem", "value": "npm" },
          { "name": "meshsync:dependencyScope", "value": $f[2] },
          { "name": "meshsync:declaredRange", "value": $f[1] }
        ]
      } ]
')"

# --- serial number (RFC 4122-shaped; content-derived fallback) ----------------
uuid=""
if [ -r /proc/sys/kernel/random/uuid ]; then
    uuid="$(cat /proc/sys/kernel/random/uuid)"
elif command -v uuidgen >/dev/null 2>&1; then
    uuid="$(uuidgen)"
else
    # Deterministic, content-derived serial so identical inputs -> identical SBOM.
    digest="$(printf '%s' "${go_tsv}${npm_tsv}${app_version}" | sha256sum | cut -d" " -f1)"
    uuid="$(printf '%s-%s-%s-%s-%s' \
        "${digest:0:8}" "${digest:8:4}" "${digest:12:4}" "${digest:16:4}" "${digest:20:12}")"
fi

timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

sbom="$(jq -n \
    --arg ts "$timestamp" \
    --arg uuid "$uuid" \
    --arg appver "$app_version" \
    --arg gomod "$go_module" \
    --arg gotc "$go_toolchain" \
    --arg pkgname "$pkg_name" \
    --argjson go "$go_components" \
    --argjson npm "$npm_components" '
    {
      "bomFormat": "CycloneDX",
      "specVersion": "1.5",
      "serialNumber": ("urn:uuid:" + $uuid),
      "version": 1,
      "metadata": {
        "timestamp": $ts,
        "tools": [
          { "vendor": "MeshSync", "name": "scripts/gen-sbom.sh", "version": "1" }
        ],
        "component": {
          "type": "application",
          "name": "MeshSync",
          "version": $appver,
          "properties": [
            { "name": "meshsync:goModule", "value": $gomod },
            { "name": "meshsync:goToolchain", "value": $gotc },
            { "name": "meshsync:webPackageName", "value": $pkgname }
          ]
        }
      },
      "components": (($go + $npm) | sort_by(.name))
    }')"

# --- self-validation: the document must parse as JSON ------------------------
printf '%s\n' "$sbom" | jq empty

go_count="$(printf '%s\n' "$go_tsv" | awk 'NF' | wc -l)"
npm_count="$(printf '%s\n' "$npm_tsv" | awk 'NF' | wc -l)"
echo "gen-sbom.sh: ${go_count} gomod + ${npm_count} npm components (CycloneDX 1.5)" >&2

if [ -n "$OUT" ] && [ "$OUT" != "-" ]; then
    printf '%s\n' "$sbom" >"$OUT"
    echo "gen-sbom.sh: wrote $OUT" >&2
else
    printf '%s\n' "$sbom"
fi
