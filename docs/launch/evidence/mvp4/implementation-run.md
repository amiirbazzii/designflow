# MVP-4 Journey 4 — Live Approved Application

Classification: `PASS` (see `visual-run.md` for the visual half)

Timestamp: 2026-08-07
DesignFlow baseline commit: `e65777e159e6502a1217665872efe98d47908677`
("fix: validate implementation proposals before approval")
Package: `designflow-ai@0.1.1`, pack shasum
`945fa2c23f2578ba86b689345718971308fb0772`, installed at
`/Users/wallex/.local/bin/designflow` → `…/designflow-ai/dist/main.js`
Run id: `fb0366d5-b6d1-49ba-9104-9b2b48897608` (completed, 5m49s, 23 artifacts)

## Readiness

`OPENROUTER_API_KEY` present (value not inspected); Figma Dev Mode MCP live
(protocol `2025-03-26`); doctor: Playwright and Chromium healthy.

## Fixture pre-run baseline

HEAD `84e182895c156098bf8a046ef5cbd7eaa8075423`; clean; empty diff;
`npm test` and `npm run build` exit 0. Independent content fingerprint
`c2ad656d7e15f23fea5ebea9e1a69039839893340eef107ff50eaf981c299c51`;
reusable components `FeatureCard.jsx`, `PrimaryButton.jsx`; 7 CSS custom
properties in `src/styles.css`.

## Canonical run

Implementation-intent request with the Spendly URL/node `1026:6098`,
project `mvp4-acceptance` (`696d56a7-…`), journey consent **yes**
(preparation only). Coordinator: live OpenRouter `openai/gpt-4o-mini`,
profile `design-engineer-coordinator-default`, success (784 tokens) —
routed to the 23-step implementation workflow.

Figma evidence: retrieved in-run through the corrected normalization;
Figma Specification Specialist live (profile
`figma-specification-default`, success, 5,500 tokens — rich-evidence
scale). Project inspection (deterministic): react 18.3.1, javascript,
npm, `src`, both `.jsx` components in the inventory, CSS token source,
build/test/preview commands. Mapping (deterministic): Button → 0.6
manual-review (below reuse threshold, candidate PrimaryButton); Text
field / Expense History Item / Navigation menu v3 → create; tokens →
create. Implementation Specialist: live OpenRouter, profile
`implementation-default`, success (2,113 tokens).

## Exact proposal (validated deterministically before approval)

4 creates, 0 modifies, 0 deletes, no package changes — the MVP-4D
validation gate ran in `store-proposed-file-changes` (existence, path
safety, duplicates, size) before the prompt:

- create `src/components/TextField.js`
- create `src/components/ExpenseHistoryItem.js`
- create `src/components/NavigationMenu.js`
- create `src/styles/tokens.css`

All targets vacant, fixture-relative, safe. Manual safety review: no
DesignFlow paths, no secrets, no destructive operations; contents are
small React components + a Poppins token stylesheet corresponding to
Spendly components.

## Approval binding and apply

Exact approval (distinct from journey consent) bound to approvalId
`e8d8c72e0dfec5685dc42623`, proposal hash
`f2cd8a137b9e052401d9ae6a3dce8db45b3f20084dc3b05df4c247958c5e83d0`,
base fingerprint `8ba1190204f81dba…`, 30-minute expiry. Answered
**approve**. Snapshot `976e9076-70fa-41bc-befc-7cc3fa77e006` was created
BEFORE mutation, covering exactly the 4 target paths (all recorded
`existed: false`), bound to the same proposal hash.

Applied result: created exactly the 4 approved files, modified none.
Git after apply: HEAD unchanged (no commit, as designed), 4 untracked
files matching the proposal exactly, no tracked diff, no other paths.

## Post-write validation

DesignFlow's deterministic validation ran the project's own commands:
build passed (exit 0), test passed (exit 0); format/typecheck/lint
truthfully `unavailable` (no such scripts). Independent `npm test` and
`npm run build` after the run: both exit 0.

## History/state/security

History: run `completed`, no stale running execution, no pending
approval, no correction child. No orphan preview/browser processes and
port 51324 free after the run. Credential grep over the stored home: no
match; all applied paths fixture-confined.

## MVP-4L — proposed-module compile validation — 2026-08-08

### Root cause being closed (from MVP-4K)

DesignFlow validated only the application's existing reachable build graph.
An implementation module nothing imported (`src/SpendlyScreen.jsx` with a
default import of the named-export-only `TextField`) passed the parent
stage and detonated only when a correction mounted it.

### Architecture (commit `2e2d43d`)

Two separate deterministic concepts, never conflated:

- **A. Proposed-module compile validity**
  (`packages/capabilities/implementation/src/proposed-state-validation.ts`):
  before approval, the exact proposal is materialized in a temporary
  OS-owned workspace (bounded project copy ≤2,000 files/20MB +
  `node_modules` symlink + exact proposed operations), a synthetic entry
  `designflow-proposed-entry.js` imports every changed executable module
  (`.js/.jsx/.ts/.tsx/.mjs`; styles/assets/docs are dependencies, not
  entries), `index.html` is pointed at it, and the project's own build
  command runs there. The registered project is never mutated; the
  workspace is removed on success, failure, and cancellation. Result is
  hash-bound to the exact proposal JSON (`proposalHash`).
- **B. Rendered reachability** (`analyzeRenderReachability`, reusing the
  MVP-4K entry/import resolution): bounded static-import traversal from
  the preview entry; changed files are recorded reachable/unreachable.
  Unreachability is evidence for the correction stage, never an error.

Integration: compile failure raises repairable
`ERR_PROPOSAL_MODULE_COMPILE_FAILED` inside the existing
`MAX_CORRECTION_PROPOSAL_ATTEMPTS = 3` loop, with bounded, path-stripped,
secret-free diagnostics (≤12 lines × 500 chars) in the structured repair
feedback (`moduleDiagnostics`). The store-proposal step revalidates the
exact stored proposal and persists a `proposed-module-validation` artifact
(status, validated files, diagnostics, proposalHash, renderReachability)
before any approval. Approval is only reachable with structural PASS +
compile PASS; unreachable-but-valid proceeds.

### Tests and regression

14 new focused tests: latent default-import defect fails while unmounted;
repaired named import passes unmounted; multi-module failure identifies
the failing module; CSS-module deps resolve without becoming entries;
hash binding; no-executable-module fast pass; missing build command →
honest `unavailable`; cancellation cleanup; zero fixture writes; three
reachability cases; two bounded-loop integration cases (regenerate with
diagnostics then succeed; 3 invalid → typed exhaustion, zero writes).
Full regression: build 26/26, typecheck 44/44, lint 26/26, test 52 tasks
— 2,477 pass / 1 skip / 0 fail; smoke exit 0; freshness exit 0. Fresh
package `14e8472c…` reinstalled and verified.

### Final Journey 6 run (parent `2b695b69-2f96-4582-8f48-9ba17fd487a1`)

Baseline `992d7d5` (fingerprint `23c36efd…`, test/build green); profiles
luna/glm unchanged. The implementation stage ran 3 bounded proposal
attempts over 8m02s and ended honestly:
`ERR_PROPOSAL_ATTEMPTS_EXHAUSTED` — "no approval was requested and no
files were changed." Verified: fixture fingerprint unchanged
(`23c36efd…`), zero writes, zero approvals, zero snapshots, no leftover
validation workspaces or build processes.

Validator integrity was proven directly against the real fixture with its
real `npm run build` (Vite): a valid named-import probe module → `passed`;
the exact latent default-import defect → `failed` with the genuine Rollup
diagnostic (`"default" is not exported by
"src/components/TextField/TextField.tsx"`). The gate is not a false
failure; the model could not produce a compile-valid proposal within the
bound in this run.

### New product debt (recorded, not fixed here)

1. **Attempt-level exhaustion metadata is not persisted**: the thrown
   error carries `failures[]` (per-attempt code/path/diagnostics) but the
   run recorder stores only `errorCode` + `reason`, so this run's three
   failure codes are unknowable after the fact. Carry into the final
   artifact/trace audit.
2. MVP-4K's cosmetic `ArtifactReconciliationError` observation stands.

### Classifications

**MVP-4L: `PASS`** — all 17 criteria hold; the live run is the negative
proof of the gate (invalid proposals can no longer reach approval or
mutate the project).
**Journey 6: `FAIL — IMPLEMENTATION_PROPOSAL_ATTEMPTS_EXHAUSTED`** — the
blocker moved to implementation-model capability under the new honest
gate: `gpt-5.6-luna` did not produce a compile-valid Spendly proposal in
3 attempts this run. Remediation options: rerun (attempt variance),
richer repair feedback, or an implementation-model decision — all outside
MVP-4L's scope.
