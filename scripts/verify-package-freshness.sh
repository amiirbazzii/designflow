#!/usr/bin/env bash
# scripts/verify-package-freshness.sh
#
# Serial, destructive-but-self-healing verification that stale generated
# workspace output cannot survive the canonical pack path (MVP-2B-3).
# Operates ONLY on generated build output (dist/, *.tsbuildinfo) — never
# on source files, user state, or .claude-flow/. On every exit path a
# forced rebuild restores valid generated output.
#
# Scenarios:
#   A  missing dependency output  → prepack rebuilds it, tarball works
#   B  corrupted/stale dependency output with a fabricated marker
#      → prepack replaces it; marker absent from bundle and tarball
#   C  warm-state determinism     → repacking without changes yields an
#      identical extracted payload (tgz bytes may differ: archive
#      metadata such as gzip mtime is not part of the payload)
#
# Run serially — never in parallel with another build or test task.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT/apps/designflow-cli"
SDK_DIST="$ROOT/packages/sdk/dist"
WORK="$(mktemp -d)"

restore() {
  rm -rf "$WORK"
  (cd "$ROOT" && bunx turbo build --force >/dev/null 2>&1) || true
}
trap restore EXIT

fail() { printf 'FRESHNESS FAIL: %s\n' "$1" >&2; exit 1; }
step() { printf '\n== %s\n' "$1"; }

pack_into() {
  local dest="$1"
  mkdir -p "$dest"
  (cd "$CLI" && npm pack --silent --pack-destination "$dest" >/dev/null)
  ls "$dest"/designflow-ai-0.2.0.tgz >/dev/null || fail "expected designflow-ai-0.2.0.tgz in $dest"
}

payload_hash() {
  local dest="$1"
  rm -rf "$dest/extract"
  mkdir -p "$dest/extract"
  tar -xzf "$dest"/designflow-ai-0.2.0.tgz -C "$dest/extract"
  (cd "$dest/extract" && find package -type f | sort | xargs shasum -a 256) | shasum -a 256 | cut -d' ' -f1
}

step "Scenario A: missing dependency output is rebuilt"
rm -rf "$SDK_DIST"
pack_into "$WORK/a"
[ -f "$SDK_DIST/index.js" ] || fail "prepack did not rebuild packages/sdk/dist"
HASH_A="$(payload_hash "$WORK/a")"
echo "ok — sdk dist rebuilt; payload $HASH_A"

step "Scenario B: corrupted dependency output is replaced; marker never ships"
MARKER="STALE_MARKER_$(date +%s)_$$"
printf '\n// %s\n' "$MARKER" >> "$SDK_DIST/index.js"
pack_into "$WORK/b"
grep -q "$MARKER" "$SDK_DIST/index.js" && fail "prepack left the marker in sdk dist"
grep -q "$MARKER" "$CLI/dist/main.js" && fail "marker reached the CLI bundle"
rm -rf "$WORK/b/extract"; mkdir -p "$WORK/b/extract"
tar -xzf "$WORK/b"/designflow-ai-0.2.0.tgz -C "$WORK/b/extract"
grep -rq "$MARKER" "$WORK/b/extract" && fail "marker reached the tarball"
HASH_B="$(payload_hash "$WORK/b")"
echo "ok — marker eliminated; payload $HASH_B"

step "Scenario C: warm-state determinism"
pack_into "$WORK/c"
HASH_C="$(payload_hash "$WORK/c")"
[ "$HASH_B" = "$HASH_C" ] || fail "payload differs between packs with unchanged source ($HASH_B vs $HASH_C)"
[ "$HASH_A" = "$HASH_B" ] || fail "payload differs between cold and warm packs ($HASH_A vs $HASH_B)"
echo "ok — identical extracted payload cold and warm: $HASH_C"

step "Installed tarball runs without Bun, Turbo, or repository scripts"
CONSUMER="$WORK/consumer"
mkdir -p "$CONSUMER"
printf '{"name":"consumer","private":true}\n' > "$CONSUMER/package.json"
(cd "$CONSUMER" && npm install --omit=optional --no-audit --no-fund "$WORK/c"/designflow-ai-0.2.0.tgz >/dev/null)
HOME_DIR="$WORK/home"
OUT="$(DESIGNFLOW_HOME="$HOME_DIR" node "$CONSUMER/node_modules/.bin/designflow" --version)"
printf '%s\n' "$OUT" | grep -q "DesignFlow 0.2.0" || fail "installed CLI --version failed"
echo "ok — installed CLI reports: $(printf '%s\n' "$OUT" | tail -1)"

printf '\nFRESHNESS VERIFICATION PASSED\n'
