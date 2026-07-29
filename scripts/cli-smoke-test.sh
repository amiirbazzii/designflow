#!/usr/bin/env bash
# scripts/cli-smoke-test.sh
#
# Proves the published CLI is genuinely installable and runnable.
#
#   npm pack  →  npm install -g ./designflow-x.y.z.tgz  →  designflow
#
# Deliberately uses `node`, a temporary npm prefix and a temporary
# DESIGNFLOW_HOME, so it exercises what a real user gets rather than the
# workspace: a tarball, resolved by npm, run by Node, against an empty home.

set -euo pipefail

CLI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../apps/designflow-cli" && pwd)"
WORK="$(mktemp -d)"
PREFIX="$WORK/npm-global"
export DESIGNFLOW_HOME="$WORK/home"
export PATH="$PREFIX/bin:$PATH"

cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
fail() { printf '\033[31mFAIL: %s\033[0m\n' "$1"; exit 1; }

step "Build"
(cd "$CLI_DIR" && npm run --silent build >/dev/null)
[ -f "$CLI_DIR/dist/main.js" ] || fail "dist/main.js was not produced"

step "npm pack"
TARBALL="$(cd "$CLI_DIR" && npm pack --silent)"
mv "$CLI_DIR/$TARBALL" "$WORK/"
echo "packed $TARBALL"

step "npm install -g ./$TARBALL"
npm install -g --prefix "$PREFIX" "$WORK/$TARBALL" >/dev/null
command -v designflow >/dev/null || fail "designflow is not on PATH after install"
echo "installed at $(command -v designflow)"

step "designflow --version"
designflow --version

step "designflow list"
designflow list | grep -q "Design Engineer" || fail "list did not show the Design Engineer worker"
designflow list | grep -q "design-to-code" && fail "list leaked a workflow id"
echo "ok"

step "designflow run design-engineer"
printf 'homepage.fig\nreact\nbrand/Header, brand/Footer\napprove\n' \
  | designflow run design-engineer | grep -q "Complete" || fail "run did not complete"
echo "ok"

step "designflow history (separate process)"
designflow history | grep -q "Design → Code" || fail "history did not list the run"
echo "ok"

step "designflow (interactive)"
printf '3\n' | designflow | grep -q "Welcome to DesignFlow" || fail "interactive mode did not start"
echo "ok"

printf '\n\033[32mSMOKE TEST PASSED\033[0m — the published package installs and runs under Node.\n'
