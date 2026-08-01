# Release Candidate Validation

**Date:** 2026-08-02
**Status:** Accepted
**Stage:** 42.5

## Context

Stage 42 closed most of the gap between "the architecture works" and "a
real user can install this and trust it," but left three release blockers
open: npm packaging was unverified, sessions/approvals had no expiry or
cleanup mechanism, and no one had actually run `npm install -g designflow`
against a packed tarball in a clean environment. This stage closes all
three and re-runs the full adversarial security sweep as a final gate
before v0.1.0. No new architecture — this is release correctness only.

## 1. npm packaging — verified, one real defect found and fixed

`apps/designflow-cli`'s build script (`bun build src/main.ts
--target=node --format=esm --outfile=dist/main.js`) already inlines every
`@designflow/*` internal workspace package into a single 724 KB
`dist/main.js`. This was previously undiagnosed and incorrectly recorded
in the Stage 42 ADR as an open gap ("still resolves ~15 `workspace:*`
packages") — corrected there. Verified directly: `grep -n "@designflow"
dist/main.js` and `grep -n "Bun\."` both return zero matches; the file
begins with `#!/usr/bin/env node`.

`npm pack --dry-run` from `apps/designflow-cli` initially produced a
3-file tarball (`README.md`, `dist/main.js`, `package.json`) — **missing
`LICENSE`**. npm only auto-includes `LICENSE`/`README.md`/`package.json`
from the package directory being published, not the repo root; the
Stage 42 `LICENSE` file lived only at the repo root. Fixed by copying it
into `apps/designflow-cli/LICENSE` (not a symlink — `docs/RELEASE_CHECKLIST.md`
now calls this out as a manual re-copy step if the root license text ever
changes). Final tarball: exactly 4 files, 123.5 kB packed / 686 kB
unpacked — `LICENSE`, `README.md`, `dist/main.js`, `package.json`. No
source, tests, ADRs, `.git`, or workspace files present.

Verified end-to-end in a fully isolated environment (temp `HOME`, temp
npm prefix via `NPM_CONFIG_PREFIX`, temp `DESIGNFLOW_HOME`, no repo files
on `PATH`): `npm pack` → `npm install -g <tarball>` (adds exactly **1**
package — no dependency resolution against any `@designflow/*` name) →
`designflow --version` → `designflow workers` → `designflow run <worker>`
for all four workers, under plain `node` (v22), with zero `bun`
involvement. `scripts/cli-smoke-test.sh` (the same journey, scripted) also
passes clean with zero warnings.

## 2. Session and approval cleanup

**Sessions** already carried `expiresAt` (set at creation, Stage 41/42)
and `isExpired`/`SessionExpiredError` already blocked answering an expired
session — but `sessionStatusSchema` had no `"expired"` value, so a stale
session's `get`/`list` result kept reporting its last real status
(`waiting_for_user`) forever. That is not a stable state, and it is not
what the spec's required status set (`active` / `waiting_for_user` /
`completed` / `failed` / `cancelled` / `expired`) describes.

**Approvals** had no expiry concept at all: `approvalStatusSchema` was
`pending`/`approved`/`rejected` only, `approvalRequestSchema` had no
`expiresAt`, and an approval left pending indefinitely could still be
approved to authorize execution with no time bound.

Fixed by:

- Adding `"expired"` to both status enums (`packages/sdk/src/session.ts`,
  `packages/sdk/src/approval.ts`), terminal in both state machines.
- Adding `expiresAt` to `approvalRequestSchema` (default
  `DEFAULT_APPROVAL_EXPIRATION_MS`, 7 days, reusing the same expiration
  concept sessions already had rather than inventing a second policy knob).
- A single shared `isSessionExpired`/`effectiveSessionStatus` helper pair
  and an `isApprovalExpired` helper (`packages/sdk`), so "is this expired"
  is computed in exactly one place and reused everywhere — `get`/`list`
  compute the *effective* status at read time (no eager rewrite needed to
  make status correct); a session only gets `expired` **persisted** when
  `cleanupExpiredSessions()` runs.
- `approve()`/`reject()` on an expired approval now throw
  `ApprovalExpiredError` (`ERR_APPROVAL_EXPIRED`) instead of silently
  succeeding — enforced identically across all four `ApprovalManager`
  implementers (`InMemoryApprovalManager`, `LocalApprovalManager`,
  `storage-file`'s `FileApprovalManager`, `storage-sqlite`'s
  `SqliteApprovalManager`).
- A new `designflow cleanup` command: marks stale `waiting_for_user`
  sessions and stale `pending` approvals as `expired`, reports exactly
  which ids it touched (or "Nothing to clean up" on a no-op run), and
  always states that completed runs and history were left untouched.
  Idempotent by construction — an already-expired session/approval is
  terminal and is never a candidate on a second run. Manual/on-demand
  only, matching the spec's explicit "do NOT build a scheduler" — no
  timer, no daemon, no startup-triggered background sweep.

Storage-growth conclusion: `cleanup` bounds **unbounded live pending
state** (a session or approval that would otherwise sit
`waiting_for_user`/`pending` forever with no way to distinguish stale from
actionable) — that was the real correctness gap. It does not, and per the
spec should not, delete anything: completed history and expired
records both persist. Raw byte/row growth of `FileStore`'s single JSON
document or the SQLite tables from months of *completed* history remains
a small, explicitly out-of-scope concern for a single-user local CLI (matches
`FileStore`'s own existing design assumption of "a few hundred rows"); no
retention-policy engine or database migration was added.

## 3. Final security sweep — clean, one coverage gap closed

Re-ran every existing adversarial suite (`packages/tools`, `packages/agents`,
`packages/models`, `apps/designflow-api/src/api.adversarial.test.ts`,
`apps/designflow-cli/src/security-audit.test.ts`,
`packages/product/src/security-audit.test.ts`) plus new live probes: a real
`designflow run` in deterministic mode with output grepped for agent ids,
workflow ids, policy rule ids, model profile ids, and stack traces (zero
hits); path-traversal and oversized project names; invalid worker/session
ids including SQL-injection-shaped strings; the packaged `dist/main.js`
grepped for secret patterns. All held. One real coverage gap — no test
for a malformed/non-JSON body on `POST /workers/:workerId/tasks` — was
closed; the underlying handler already coerced bad input safely (never a
500, never a stack trace), it just wasn't locked in by a test until now.

Noted, not fixed (low risk, tracked as follow-up): `apps/designflow-web`'s
network tests assert statically that the client schema never carries
internal vocabulary, but don't run a live forbidden-string sweep of actual
response payloads the way the API suite does. The server already strips
this vocabulary and the client schema statically excludes it, so this is
a coverage-depth gap, not a known leak.

## Verification

- `bunx turbo build --force` — 23/23 packages.
- `bun run typecheck` — 41/41 tasks.
- `bunx turbo lint --continue --force` — 23/23 packages, 0 errors.
- `bunx turbo test --continue --force` — 45/46 test tasks pass; the sole
  failure is the same pre-existing `@designflow/capability-test-artifact`
  package (zero test files) noted in Stage 42, untouched by this stage.
  1945+ individual tests pass repo-wide, 0 fail.
- `scripts/cli-smoke-test.sh` — full pass, zero warnings, against the
  rebuilt tarball (including the new `cleanup` command).
- Isolated npm install (temp HOME/prefix/DESIGNFLOW_HOME, plain Node) —
  pass, all four workers, `designflow cleanup` verified working from the
  packed tarball.

## Known limitations (still open after this stage)

- `apps/designflow-web` has no live runtime-payload leak sweep, only
  static schema assertions (see §3).
- Raw storage-size growth from completed history over long-lived single-user
  installs is unmanaged by design — acceptable at CLI scale, would need
  revisiting if DesignFlow ever became multi-user or server-hosted.
- npm publishing itself remains un-run; `docs/RELEASE_CHECKLIST.md` is
  ready but the publish step requires separate human confirmation.
