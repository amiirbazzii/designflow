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

# Installed-distribution checks must not inherit operator credentials.
unset OPENROUTER_API_KEY FIGMA_ACCESS_TOKEN FIGMA_TOKEN 2>/dev/null || true

# Real-home protection: anything newer than this marker inside the real
# ~/.designflow at the end of the run is a state-isolation failure.
REAL_HOME_MARKER="$WORK/real-home-marker"
touch "$REAL_HOME_MARKER"

RESULTS=()
mark() { RESULTS+=("$1: $2"); }

cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
fail() { printf '\033[31mFAIL: %s\033[0m\n' "$1"; exit 1; }
# A `warn` is for a real, reproduced product finding that this script does not
# own fixing (this file only proves the packaged CLI's journey end to end) —
# printed loudly, in yellow, tallied, but not fatal: silently downgrading a
# check to avoid ever printing it would be the actual dishonesty, not this.
WARNINGS=0
warn() { printf '\033[33mWARNING: %s\033[0m\n' "$1"; WARNINGS=$((WARNINGS + 1)); }

step "npm pack (prepack performs the canonical forced workspace build)"
# No separate CLI-only build here: packing MUST go through the prepack
# lifecycle (scripts/prepare-cli-package.sh), which rebuilds the whole
# workspace dependency graph from source — a CLI-only build can bundle
# stale dependency dist output.
TARBALL="$(cd "$CLI_DIR" && npm pack --silent | tail -1)"
[ -f "$CLI_DIR/dist/main.js" ] || fail "dist/main.js was not produced by prepack"
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

# ── Stage 41: the full four-worker catalogue ─────────────────────

step "designflow workers lists all four workers"
WORKERS="$(designflow workers)"
for name in "Design Engineer" "QA Reviewer" "Research Analyst" "Product Manager"; do
  grep -q "$name" <<<"$WORKERS" || fail "workers did not list: $name"
done
echo "ok"

step "designflow workers <id> — detail for every worker, no internal ids"
# Kept per-worker (not just looped-and-discarded) so the later leak-check step
# can grep each one individually and say exactly which command leaked what.
DETAIL_DESIGN_ENGINEER="$(designflow workers design-engineer)"
DETAIL_QA_REVIEWER="$(designflow workers qa-reviewer)"
DETAIL_RESEARCH_ANALYST="$(designflow workers research-analyst)"
DETAIL_PRODUCT_MANAGER="$(designflow workers product-manager)"
for id in design-engineer qa-reviewer research-analyst product-manager; do
  case "$id" in
    design-engineer) DETAIL="$DETAIL_DESIGN_ENGINEER" ;;
    qa-reviewer) DETAIL="$DETAIL_QA_REVIEWER" ;;
    research-analyst) DETAIL="$DETAIL_RESEARCH_ANALYST" ;;
    product-manager) DETAIL="$DETAIL_PRODUCT_MANAGER" ;;
  esac
  grep -q "designflow run $id" <<<"$DETAIL" || fail "workers $id did not show its run command"
  grep -qE "\-agent" <<<"$DETAIL" && fail "workers $id leaked an agent id"
done
echo "ok"

step "designflow run design-engineer — setup guidance without a Figma connection (MVP-3B)"
# The flagship no longer runs the legacy scaffold: without a configured
# Figma MCP it explains the prerequisite, names a command (not an internal
# flag), runs nothing, and exits 1.
RUN_DESIGN_ENGINEER="$(designflow run design-engineer </dev/null 2>&1)" && fail "design-engineer should exit 1 without a Figma connection" || true
grep -q "connected Figma design" <<<"$RUN_DESIGN_ENGINEER" || fail "no Figma setup guidance shown"
grep -q "designflow doctor" <<<"$RUN_DESIGN_ENGINEER" || fail "guidance did not name designflow doctor"
grep -q "Nothing was run and no files were changed." <<<"$RUN_DESIGN_ENGINEER" || fail "guidance did not state that nothing ran"
grep -q "settings.experimental" <<<"$RUN_DESIGN_ENGINEER" && fail "guidance leaked an internal flag name"
echo "ok"

step "designflow run qa-reviewer"
RUN_QA_REVIEWER="$(printf 'src/components/Header.tsx\naccessibility\nmajor\napprove\n' \
  | designflow run qa-reviewer)"
grep -q "Complete" <<<"$RUN_QA_REVIEWER" || fail "qa-reviewer run did not complete"
echo "ok"

step "designflow run research-analyst"
RUN_RESEARCH_ANALYST="$(printf 'What are the tradeoffs of server components?\nreact-docs, perf-blog\nstandard\napprove\n' \
  | designflow run research-analyst)"
grep -q "Complete" <<<"$RUN_RESEARCH_ANALYST" || fail "research-analyst run did not complete"
echo "ok"

step "designflow run product-manager"
RUN_PRODUCT_MANAGER="$(printf 'Let users export their history as CSV\nExisting CLI users\nmust ship without a new dependency\nstandard\napprove\n' \
  | designflow run product-manager)"
grep -q "Complete" <<<"$RUN_PRODUCT_MANAGER" || fail "product-manager run did not complete"
echo "ok"

step "designflow history (separate process) — completed workers, worker vocabulary"
HISTORY="$(designflow history)"
for name in "QA Review" "Research Analysis" "Product Brief"; do
  grep -q "$name" <<<"$HISTORY" || fail "history did not list: $name"
done
# The design-engineer guidance ran nothing, so no Design → Code entry exists.
grep -q "Design → Code" <<<"$HISTORY" && fail "a run appeared for the design-engineer guidance path"
echo "ok"

# ── Clarification / session resume ────────────────────────────────
#
# `designflow run`'s own form always falls back to the field's placeholder
# when an answer is empty (see collectInput in commands/run.ts), so genuinely
# empty input — the thing that actually leaves a session `waiting_for_user` —
# is not reachable by piping blank lines at `designflow run`. It is only
# reachable the way apps/designflow-cli/src/clarification-resume-regression.test.ts
# reaches it: calling `sessions.startSession` directly with `request: ""` and
# `input: {}`. That entry point is exported from the CLI's own library surface
# (apps/designflow-cli/src/index.ts, package.json "main"/"exports" ->
# dist/index.js) — but `npm run build` only emits dist/main.js, so the
# installed tarball has no working dist/index.js (this is a real gap in the
# package, not something this smoke test can paper over by itself). The
# workspace source is used here to start the session; the *installed* global
# `designflow` binary (already on PATH) is what resumes it via the same
# `designflow answer <id>` a person would actually type.
step "clarification: a genuinely empty session starts waiting_for_user"
cat > "$WORK/trigger-clarification.ts" <<EOF
import { createCliContext } from "$CLI_DIR/src/index.ts";

const workerId = process.argv[2];
if (workerId === undefined) throw new Error("usage: trigger-clarification.ts <workerId>");

const context = createCliContext();
const started = await context.sessions.startSession({ workerId, request: "", input: {} });
console.log(started.session.id);
console.log(started.session.status);
context.close();
EOF

CLARIFY_START="$(bun run "$WORK/trigger-clarification.ts" qa-reviewer)"
SESSION_ID="$(sed -n '1p' <<<"$CLARIFY_START")"
SESSION_STATUS="$(sed -n '2p' <<<"$CLARIFY_START")"
[ -n "$SESSION_ID" ] || fail "starting qa-reviewer with empty request/input produced no session id"
[ "$SESSION_STATUS" = "waiting_for_user" ] \
  || fail "starting qa-reviewer with empty request/input did not leave the session waiting_for_user (got: $SESSION_STATUS)"
echo "ok — session $SESSION_ID is waiting_for_user"

step "designflow sessions — the waiting session is visible"
SESSIONS_WAITING="$(designflow sessions)"
grep -q "$SESSION_ID" <<<"$SESSIONS_WAITING" || fail "designflow sessions did not list the waiting session"
grep -q "QA Reviewer" <<<"$SESSIONS_WAITING" || fail "designflow sessions did not show the worker by name"
echo "ok"

step "designflow answer <session-id> — resolves the clarification and completes the run"
RUN_CLARIFIED="$(printf 'Review src/components/Header.tsx for accessibility issues.\napprove\n' \
  | designflow answer "$SESSION_ID")"
grep -q "needs more information" <<<"$RUN_CLARIFIED" || fail "answer did not show the clarifying question"
grep -q "Complete" <<<"$RUN_CLARIFIED" || fail "answering the clarification did not complete the run"
echo "ok"

step "designflow history — the clarified run is now visible too"
HISTORY_AFTER_CLARIFY="$(designflow history)"
QA_COUNT="$(grep -c "QA Review" <<<"$HISTORY_AFTER_CLARIFY" || true)"
[ "$QA_COUNT" -ge 2 ] || fail "history should now show two QA Review runs (the normal one and the clarified one), saw $QA_COUNT"
echo "ok"

step "designflow settings — every worker's own provider/model"
SETTINGS="$(designflow settings)"
grep -q "4 installed" <<<"$SETTINGS" || fail "settings did not report four workers"
for line in "Design Engineer" "QA Reviewer" "Research Analyst" "Product Manager"; do
  grep -q "$line" <<<"$SETTINGS" || fail "settings did not show an assignment for: $line"
done
# Two distinct providers/models proves no single global model is in effect.
grep -q "openai/gpt-4o-mini" <<<"$SETTINGS" || fail "settings did not show the Design Engineer's model"
grep -q "anthropic/claude-3.5-haiku" <<<"$SETTINGS" || fail "settings did not show the QA Reviewer's model"
echo "ok"

step "designflow projects and designflow memory still work alongside four workers"
designflow projects | grep -q "No projects registered yet." || fail "projects did not run"
designflow memory | grep -q "Nothing remembered yet." || fail "memory did not run"
echo "ok"

step "restart (new process): every completed worker's run survives"
RESTARTED_HISTORY="$(designflow history)"
for name in "QA Review" "Research Analysis" "Product Brief"; do
  grep -q "$name" <<<"$RESTARTED_HISTORY" || fail "history lost a run across a restart: $name"
done
echo "ok"

step "designflow (interactive)"
MENU="$(printf 'q\n' | designflow)"
grep -q "DesignFlow" <<<"$MENU" || fail "interactive mode did not start"
for screen in "Project" "Design" "AI" "Sign-in required" "Status" "Enter  Continue with Google" "q      Quit" "?      Help"; do
  grep -q "$screen" <<<"$MENU" || fail "the product shell is missing: $screen"
done
echo "ok"

# ── Storage hardening: no false-positive corruption/lock errors ────
#
# packages/storage-file's FileStore now detects corruption and locking. This
# whole run — build, pack, install, four fresh workers, four runs, a
# clarification, an approval, two `history` reads and a restart, all against
# one FileStore-backed database — is exactly the normal sequential traffic
# that hardening must never mistake for either condition.
step "storage hardening: no ERR_STORE_CORRUPTED / ERR_STORE_LOCKED anywhere in this run"
ALL_OUTPUT_SO_FAR="$FIRST
$OUT
$WORKERS
$DETAIL_DESIGN_ENGINEER
$DETAIL_QA_REVIEWER
$DETAIL_RESEARCH_ANALYST
$DETAIL_PRODUCT_MANAGER
$RUN_DESIGN_ENGINEER
$RUN_QA_REVIEWER
$RUN_RESEARCH_ANALYST
$RUN_PRODUCT_MANAGER
$HISTORY
$SESSIONS_WAITING
$RUN_CLARIFIED
$HISTORY_AFTER_CLARIFY
$SETTINGS
$RESTARTED_HISTORY
$MENU"
grep -q "ERR_STORE_CORRUPTED" <<<"$ALL_OUTPUT_SO_FAR" && fail "a false-positive ERR_STORE_CORRUPTED appeared during normal sequential use"
grep -q "ERR_STORE_LOCKED" <<<"$ALL_OUTPUT_SO_FAR" && fail "a false-positive ERR_STORE_LOCKED appeared during normal sequential use"
echo "ok"

# ── Leak checks: no internal vocabulary in any user-facing output ──
#
# Checked per-command-output, not just pooled, so a failure names exactly
# which command leaked what rather than "somewhere in this whole run".
step "no internal vocabulary leaked anywhere in this run"

declare -a NAMED_OUTPUTS=(
  "designflow workers" "$WORKERS"
  "designflow workers design-engineer" "$DETAIL_DESIGN_ENGINEER"
  "designflow workers qa-reviewer" "$DETAIL_QA_REVIEWER"
  "designflow workers research-analyst" "$DETAIL_RESEARCH_ANALYST"
  "designflow workers product-manager" "$DETAIL_PRODUCT_MANAGER"
  "designflow run design-engineer" "$RUN_DESIGN_ENGINEER"
  "designflow run qa-reviewer" "$RUN_QA_REVIEWER"
  "designflow run research-analyst" "$RUN_RESEARCH_ANALYST"
  "designflow run product-manager" "$RUN_PRODUCT_MANAGER"
  "designflow sessions" "$SESSIONS_WAITING"
  "designflow answer (clarified run)" "$RUN_CLARIFIED"
  "designflow history" "$HISTORY"
  "designflow history (after clarify)" "$HISTORY_AFTER_CLARIFY"
  "designflow settings" "$SETTINGS"
  "designflow history (restart)" "$RESTARTED_HISTORY"
  "designflow (interactive menu)" "$MENU"
)

# agentId (e.g. design-engineer-agent, qa-reviewer-agent, research-analyst-agent,
# product-manager-agent), the internal workflow id (distinct from the display
# name — "qa-review" the id vs. "QA Review" the name), the per-worker model
# profile id, the tool ids the deterministic strategies classify with, and the
# raw provider id / a credential fragment.
LEAK_PATTERNS=(
  "\-agent\b"
  "modelProfileId"
  "design-to-code"
  "qa-review\b"
  "research-analysis"
  "product-brief"
  "design-engineer-default"
  "qa-reviewer-default"
  "research-analyst-default"
  "product-manager-default"
  "approve-code-generation"
  "approve-qa-report"
  "approve-research-brief"
  "approve-product-brief"
  "classify-design-task"
  "classify-review-target"
  "classify-research-request"
  "classify-product-request"
  "sk-or-"
)

LEAK_FOUND=0
for ((i = 0; i < ${#NAMED_OUTPUTS[@]}; i += 2)); do
  LABEL="${NAMED_OUTPUTS[i]}"
  OUTPUT="${NAMED_OUTPUTS[i + 1]}"
  for PATTERN in "${LEAK_PATTERNS[@]}"; do
    if grep -qE "$PATTERN" <<<"$OUTPUT"; then
      printf '\033[31mFAIL: %s leaked internal vocabulary matching /%s/\033[0m\n' "$LABEL" "$PATTERN"
      LEAK_FOUND=1
    fi
  done

  # `openrouter` (lowercase, the raw provider id) must never reach a user's
  # terminal: every user-facing surface routes provider ids through
  # displayProviderName ("OpenRouter") since MVP-3D. A hard failure, not a
  # warning — a regression here is a real product leak.
  if grep -q "openrouter" <<<"$OUTPUT"; then
    printf '\033[31mFAIL: %s printed the raw provider id 'openrouter' verbatim (should be the display name 'OpenRouter')\033[0m\n' "$LABEL"
    LEAK_FOUND=1
  fi
done

[ "$LEAK_FOUND" -eq 0 ] || fail "internal vocabulary leaked into user-facing output — see FAIL lines above"
echo "ok"


# ════════════════════════════════════════════════════════════════
# MVP-2B-4 expanded installed-distribution matrix
# ════════════════════════════════════════════════════════════════
mark "package" "PASS"          # pack + prepack + dist assertions above
mark "global-prefix install" "PASS"
mark "CLI commands (global journey)" "PASS"

step "tarball inventory and packed manifest"
TARLIST="$(tar -tzf "$WORK/$TARBALL" | sort)"
EXPECTED_TARLIST="package/LICENSE
package/README.md
package/dist/main.js
package/package.json"
[ "$TARLIST" = "$EXPECTED_TARLIST" ] || fail "tarball contents differ from the documented 4-file MVP payload: $TARLIST"
mkdir -p "$WORK/extract" && tar -xzf "$WORK/$TARBALL" -C "$WORK/extract"
node -e '
  const fs = require("fs");
  const pkg = JSON.parse(fs.readFileSync(process.argv[1] + "/package/package.json", "utf8"));
  const assert = (cond, msg) => { if (!cond) { console.error("packed manifest: " + msg); process.exit(1); } };
  assert(pkg.name === "designflow-ai", "name");
  assert(pkg.version === "0.2.0", "version");
  assert(pkg.bin && pkg.bin.designflow === "dist/main.js", "bin");
  assert(pkg.main === undefined && pkg.types === undefined, "no library entry point");
  assert(JSON.stringify(pkg.exports) === JSON.stringify({"./package.json": "./package.json"}), "exports is ./package.json only");
' "$WORK/extract" || fail "packed manifest contract violated"
head -c 19 "$WORK/extract/package/dist/main.js" | grep -q "#!/usr/bin/env node" || fail "packed bundle lost its shebang"
[ -x "$WORK/extract/package/dist/main.js" ] || fail "packed bundle is not executable"
echo "ok — 4 files, manifest and binary contract intact"
mark "tarball contract" "PASS"

step "security scan: tarball and bundle hygiene"
grep -qE "designflow-cli/src/|\.claude-flow|\.env$" <<<"$TARLIST" && fail "tarball contains source, env, or local tooling entries"
BUNDLE_FILE="$WORK/extract/package/dist/main.js"
grep -qE "sk-or-v1-[A-Za-z0-9]{8}|ghp_[A-Za-z0-9]{8}|AKIA[A-Z0-9]{8}|-----BEGIN [A-Z ]*PRIVATE" "$BUNDLE_FILE" && fail "credential-shaped value in bundle"
grep -q "/Users/wallex" "$BUNDLE_FILE" && fail "operator path in bundle"
grep -q "FAKE_MCP_FIXTURES" "$BUNDLE_FILE" && fail "test fixture vocabulary in bundle"
echo "ok — no secrets, operator paths, fixtures, or local state in the package"
mark "security scan" "PASS"

step "local isolated consumer install (--omit=optional, no Playwright)"
CONSUMER="$WORK/consumer"
mkdir -p "$CONSUMER"
printf '{"name":"smoke-consumer","private":true}\n' > "$CONSUMER/package.json"
(cd "$CONSUMER" && npm install --omit=optional --no-audit --no-fund "$WORK/$TARBALL" >/dev/null)
LOCAL_BIN="$CONSUMER/node_modules/.bin/designflow"
[ -x "$LOCAL_BIN" ] || fail "consumer install produced no executable designflow bin"
BIN_TARGET="$(node -e 'console.log(require("fs").realpathSync(process.argv[1]))' "$LOCAL_BIN")"
grep -q "$CONSUMER/node_modules/designflow-ai" <<<"$BIN_TARGET" || fail "installed bin does not resolve inside the consumer installation: $BIN_TARGET"
echo "ok — bin resolves to $BIN_TARGET"
mark "local install" "PASS"

step "installed CLI non-destructive command matrix (fresh isolated home)"
LOCAL_HOME="$WORK/local-home"
lcli() { DESIGNFLOW_HOME="$LOCAL_HOME" "$LOCAL_BIN" "$@"; }
lcli --help | grep -q "your AI workforce" || fail "--help"
lcli --version | grep -q "DesignFlow 0.2.0" || fail "--version"
lcli workers | grep -q "Design Engineer" || fail "workers"
DOCTOR="$(lcli doctor)"
grep -q "Doctor is read-only" <<<"$DOCTOR" || fail "doctor did not state its read-only contract"
lcli settings | grep -q "DesignFlow 0.2.0" || fail "settings"
lcli projects | grep -q "No projects registered yet." || fail "projects empty state"
lcli history | grep -q "Nothing has run yet." || fail "history empty state"
lcli sessions | grep -q "Nothing is waiting on you" || fail "sessions empty state"
lcli traces | grep -q "No AI decisions have been made yet." || fail "traces empty state"
# `artifacts` without a run id exits 1 by design (documented
# missing-argument behavior) while printing usage — assert both facts.
ARTIFACTS_OUT="$(lcli artifacts 2>&1)" && ARTIFACTS_CODE=0 || ARTIFACTS_CODE=$?
[ "$ARTIFACTS_CODE" -eq 1 ] || fail "artifacts without an id should exit 1 (documented missing-argument behavior), got $ARTIFACTS_CODE"
grep -q "designflow artifacts <run-id>" <<<"$ARTIFACTS_OUT" || fail "artifacts missing-argument usage text"
lcli memory | grep -q "Nothing remembered yet." || fail "memory empty state"
lcli cleanup | grep -q "Nothing to clean up." || fail "cleanup empty state"
echo "ok — 12 commands, exit 0, stable empty-state semantics"
mark "CLI commands (local consumer)" "PASS"

step "onboarding surfaces are discoverable and honest (MVP-3C)"
# Readiness is reported, never fatal: this environment has no credential, no
# Figma configuration and no registered project, and doctor still exits 0
# above.
grep -q "Design Engineer readiness" <<<"$DOCTOR" || fail "doctor is missing the readiness section"
grep -q "Deterministic fallback" <<<"$DOCTOR" || fail "doctor did not name the deterministic fallback"
grep -q "settings.experimental" <<<"$DOCTOR" && fail "doctor leaked experimental configuration vocabulary"
SETTINGS_OUT="$(lcli settings)"
grep -q "Design Engineer Coordinator" <<<"$SETTINGS_OUT" || fail "settings does not list the coordinator role"
grep -q "Figma Specification Specialist" <<<"$SETTINGS_OUT" || fail "settings does not list the specification role"
grep -q "sk-or-" <<<"$SETTINGS_OUT" && fail "settings printed a credential-shaped value"
lcli --help | grep -q "designflow doctor" || fail "help does not mention doctor"
echo "ok — readiness, agent roster and help are discoverable; no secrets or internal keys"
mark "onboarding discoverability" "PASS"

step "no-credential and no-Figma honesty (doctor, env-isolated)"
grep -q "No model-provider credential is configured; deterministic execution remains available." <<<"$DOCTOR" \
  || fail "doctor did not report the missing model credential honestly"
grep -q "Figma MCP integration is not configured" <<<"$DOCTOR" || fail "doctor did not report Figma as unconfigured"
grep -qE "sk-or-|OPENROUTER_API_KEY=[^ ]" <<<"$DOCTOR" && fail "doctor printed a credential-shaped value"
mark "credentials/config honesty" "PASS"
echo "ok"

step "optional Playwright absence is honest (package omitted, not falsely healthy)"
[ -d "$CONSUMER/node_modules/playwright" ] && fail "--omit=optional still installed playwright"
grep -q "\[unavailable\] browser:" <<<"$DOCTOR" || fail "doctor did not report the browser as unavailable"
grep -q "\[healthy\] browser" <<<"$DOCTOR" && fail "doctor claimed a healthy browser without Playwright"
echo "ok — renderer absence reported, never a false visual pass"
mark "Playwright absent" "PASS"

step "experimental Design Engineer implementation path stays gated"
GATED="$(lcli run design-to-code-figma-specification </dev/null 2>&1 || true)"
grep -qi "no such worker" <<<"$GATED" || fail "the experimental workflow id resolved without the experimental flag"
echo "ok — experimental workflow unreachable without explicit configuration"
mark "registrations & gating" "PASS"

step "CLI-only import contract from the consumer project"
IMPORT_PROBE="$(cd "$CONSUMER" && node -e 'import("designflow-ai").then(() => { console.log("RESOLVED"); process.exit(7); }, (e) => { console.log(e.code ?? e.name); })')"
grep -q "ERR_PACKAGE_PATH_NOT_EXPORTED" <<<"$IMPORT_PROBE" || fail "root import did not fail with the documented error: $IMPORT_PROBE"
META_PROBE="$(cd "$CONSUMER" && node -e 'const p = require("designflow-ai/package.json"); if (p.version !== "0.2.0") process.exit(1); console.log("META-ONLY");')"
[ "$META_PROBE" = "META-ONLY" ] || fail "package.json export failed or produced side-effect output: $META_PROBE"
echo "ok — root import rejected, metadata importable, no side effects"
mark "CLI-only contract" "PASS"

step "npm exec against the local tarball (documented package name designflow-ai)"
NPX_OUT="$(cd "$WORK" && DESIGNFLOW_HOME="$WORK/npx-home" npm exec --yes --package="$WORK/$TARBALL" -- designflow --version 2>/dev/null | tail -1)"
grep -q "DesignFlow 0.2.0" <<<"$NPX_OUT" || fail "npm exec local-tarball invocation failed: $NPX_OUT"
echo "ok — $NPX_OUT"
mark "npm-exec" "PASS"

step "installed-binary EPIPE: early-closing consumer under pipefail"
lcli workers | grep -q "Design Engineer" || fail "piped workers | grep -q failed under pipefail (EPIPE regression)"
echo "ok — pipeline succeeded; no unhandled EPIPE (nonzero-failure precedence is covered by the dedicated epipe-acceptance suite)"
mark "EPIPE (installed)" "PASS"

step "installed-binary SIGINT: interrupted process dies with 130 and no stack trace"
# Evidence class: installed-binary interrupt while the CLI is waiting on
# piped stdin (pre-dispatch). The full graceful workflow-cancellation path
# (cancelled record, MCP child teardown, store close) is covered at source
# level by sigint-acceptance.test.ts — that distinction is deliberate and
# recorded as a limitation, not hidden.
SIGINT_OUT="$WORK/sigint-out.log"
DESIGNFLOW_HOME="$LOCAL_HOME" "$LOCAL_BIN" run design-engineer > "$SIGINT_OUT" 2>&1 < <(sleep 300) &
SIGINT_PID=$!
sleep 1
kill -INT "$SIGINT_PID" 2>/dev/null || true
for _ in $(seq 1 50); do
  if ! kill -0 "$SIGINT_PID" 2>/dev/null; then break; fi
  sleep 0.1
done
kill -0 "$SIGINT_PID" 2>/dev/null && { kill -9 "$SIGINT_PID"; fail "installed CLI did not exit after SIGINT"; }
SIGINT_CODE=0
wait "$SIGINT_PID" 2>/dev/null && SIGINT_CODE=0 || SIGINT_CODE=$?
[ "$SIGINT_CODE" -eq 130 ] || fail "installed CLI SIGINT exit code was $SIGINT_CODE, expected 130"
grep -q "    at " "$SIGINT_OUT" && fail "SIGINT produced a stack trace"
echo "ok — exit 130, no stack trace (workflow-level graceful cancellation evidence lives in sigint-acceptance.test.ts)"
mark "SIGINT (installed)" "PASS_WITH_LIMITATION (pre-dispatch interrupt; graceful workflow cancellation proven at source level)"

step "project registration fixture through the installed CLI"
PROJ="$WORK/fixture-project"
mkdir -p "$PROJ"
printf '{"name":"smoke-fixture","dependencies":{"react":"18.0.0"}}\n' > "$PROJ/package.json"
touch "$PROJ/package-lock.json"
PROJ_SUM_BEFORE="$(find "$PROJ" -type f -exec shasum -a 256 {} + | sort | shasum -a 256)"
lcli projects add --name SmokeFixture --path "$PROJ" | grep -q "Project registered" || fail "projects add failed"
lcli projects | grep -q "$PROJ" || fail "projects did not list the canonical fixture path"
lcli doctor | grep -q "SmokeFixture is accessible" || fail "doctor did not inspect the registered project"
PROJ_SUM_AFTER="$(find "$PROJ" -type f -exec shasum -a 256 {} + | sort | shasum -a 256)"
[ "$PROJ_SUM_BEFORE" = "$PROJ_SUM_AFTER" ] || fail "audit-only commands modified the fixture project"
echo "ok — registered, listed, inspected, unmodified"
mark "project fixture" "PASS"

step "state isolation: created state parses; nothing written to the real home or repository"
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$LOCAL_HOME/config.json" || fail "isolated config.json does not parse"
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$LOCAL_HOME/history/runs.json" || fail "isolated runs.json does not parse"
echo "created state: $(cd "$LOCAL_HOME" && find . -type f | sort | tr '\n' ' ')"
if [ -d "$HOME/.designflow" ]; then
  REAL_TOUCHED="$(find "$HOME/.designflow" -newer "$REAL_HOME_MARKER" -type f | head -5)"
  [ -z "$REAL_TOUCHED" ] || fail "files were written under the real ~/.designflow: $REAL_TOUCHED"
fi
echo "ok — all state under isolated homes; real ~/.designflow untouched"
mark "state isolation" "PASS"

printf '\n\033[1m== MVP-2B-4 smoke matrix ==\033[0m\n'
for line in "${RESULTS[@]}"; do printf '  %s\n' "$line"; done

step "cleanup: temporary global install is removed on exit"
# `cleanup` is registered on `trap ... EXIT` at the top of this script and has
# already fired for every early exit above; this step just states plainly
# that it is what removes $WORK (npm prefix, DESIGNFLOW_HOME, the tarball,
# and trigger-clarification.ts) once this script's process ends, success or
# failure alike.
echo "ok — \$WORK ($WORK) is removed by the EXIT trap regardless of how this script ends"

if [ "$WARNINGS" -gt 0 ]; then
  printf '\n\033[33m%s warning(s) — see above. The published package installs and runs under Node, but read the warnings.\033[0m\n' "$WARNINGS"
else
  printf '\n\033[32mSMOKE TEST PASSED\033[0m — the published package installs and runs under Node.\n'
fi
