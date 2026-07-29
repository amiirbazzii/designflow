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

# The first-run check has to come before anything else that starts the CLI:
# every command prepares the application directory, so a `--version` here would
# consume the one first run there is.
step "first run creates the application directory"
[ -d "$DESIGNFLOW_HOME" ] && fail "the home already exists before the first run"
FIRST="$(designflow list)"
grep -q "Welcome to DesignFlow" <<<"$FIRST" || fail "no onboarding on the first run"
grep -q "Available AI Workers" <<<"$FIRST" || fail "did not continue into the application"
for entry in config.json history cache; do
  [ -e "$DESIGNFLOW_HOME/$entry" ] || fail "$entry was not created"
done
grep -q '"firstRunCompleted": true' "$DESIGNFLOW_HOME/config.json" \
  || fail "config.json does not record that setup completed"
echo "ok"

step "designflow --version"
designflow --version | grep -q "DesignFlow" || fail "--version did not name the product"
echo "ok"

step "second run skips onboarding"
designflow list | grep -q "Welcome to DesignFlow" && fail "onboarding was shown twice"
echo "ok"

step "designflow settings"
designflow settings | grep -q "$DESIGNFLOW_HOME" || fail "settings did not report the home"
echo "ok"

step "errors carry no stack trace"
BROKEN="$WORK/afile"
touch "$BROKEN"
OUT="$(DESIGNFLOW_HOME="$BROKEN/home" designflow list 2>&1 || true)"
grep -q "DESIGNFLOW_HOME" <<<"$OUT" || fail "the error suggested no next action"
grep -q "    at " <<<"$OUT" && fail "a stack trace reached the user"
echo "ok"

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
MENU="$(printf '4\n' | designflow)"
grep -q "DesignFlow AI" <<<"$MENU" || fail "interactive mode did not start"
for option in "1. Use an AI Worker" "2. View History" "3. Settings" "4. Exit"; do
  grep -q "$option" <<<"$MENU" || fail "the main menu is missing: $option"
done
echo "ok"

printf '\n\033[32mSMOKE TEST PASSED\033[0m — the published package installs and runs under Node.\n'
