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

## MVP-4M — GLM implementation profile + final Journey 6 attempt — 2026-08-08

### Setup

- Baseline `a2287a1` unchanged (no product source change; profile switch is
  acceptance-home configuration only). Installed CLI verified fresh with
  the MVP-4L validator present.
- `implementation-default` → `z-ai/glm-5.2` (8000/120000);
  `visual-correction-default` already `z-ai/glm-5.2`. `designflow settings`
  proof: only those two profiles show `(override)`; coordinator, Figma
  specification, and visual validation remain built-in gpt-4o-mini.
  Note: the CLI resolves the acceptance home via `DESIGNFLOW_HOME`.
- One bounded structured probe: HTTP 200, 3s, valid strict-schema JSON,
  provider Baidu, no 402.
- Fixture baseline `992d7d5`, fingerprint `23c36efd…`, test/build green.

### Run (parent `57f5595f-be53-43f1-ac51-f621bfe83dd6`)

- Attempt 1: `ERR_PROPOSAL_TARGET_EXISTS` (`src/pages/AddExpensePage.jsx`
  proposed as create over an existing file) → structured repair feedback.
- Attempt 2: structurally valid 1-file modify of the same path;
  MVP-4L proposed-state validation `passed` (`npm run build` in the
  temporary workspace, no diagnostics, proposalHash `c0861bfd…`);
  reachability honestly recorded `previewEntry: src/main.jsx`,
  `unreachableChangedFiles: [src/pages/AddExpensePage.jsx]`.
- Recorded GLM implementation usage: 1,779 in / 3,003 out tokens
  (≈ $0.0157) for the persisted invocation; two attempts consumed of the
  hard 3-attempt bound.
- **Manual implementation quality gate (un-scripted; the driver halts at
  the implementation approval until a reviewed decision file exists):**
  the persisted proposal payload shows `"content": ""` — the modify would
  BLANK the existing `AddExpensePage.jsx`. Compile validation passing is
  honest (an empty module is valid JavaScript), but the Part-12 question
  — does this modify meaningful Spendly implementation code? — is No; it
  is a destructive no-op. **Rejected.**
- Product behaved exactly to contract: "Rejected. The workflow was
  stopped. Nothing was written to your project." Fixture fingerprint
  byte-identical (`23c36efd…`); no approvals consumed, no snapshot, no
  correction child, no orphan processes or workspaces; no credential in
  logs.

### New product finding (recorded, not fixed)

An empty-content `modify` of an executable module passes structural
validation and compile validation and reaches the exact approval prompt,
and the CLI implementation-approval summary shows only file paths and
reasons — no content size or bounded diff — so only artifact-level manual
review exposes the blanking. Final-audit candidates: (a) deterministic
rejection or explicit flagging of empty/whitespace-only executable
content in `validateProposedFileChanges` or the module gate; (b) a
bounded content diff in the implementation approval prompt, as the
correction approval already provides.

### Classifications

**MVP-4M: `PASS`** — profile switch isolated to `implementation-default`;
gate authoritative; 3-attempt bound intact (2 used); no model cycling;
canonical Journey 6 run executed exactly once; all safety boundaries
held; zero writes.
**Journey 6: `FAIL — IMPLEMENTATION_PROPOSAL_REJECTED_QUALITY (empty
modify content)`** — GLM repaired the structural error but emitted an
empty implementation body. Correction-stage machinery remains proven from
MVP-4K; the remaining blocker is the Implementation Agent proposal
contract: nothing forces (or even surfaces) non-empty meaningful content.
Recommended next architectural decision: minimum-content/no-op rejection
in the deterministic gate plus bounded diff at the approval prompt,
before any further implementation-model work.

## MVP-4N — proposal content integrity + approval diff + final Journey 6 attempt — 2026-08-08

### Product changes (commit `f05dea6`)

- `validateProposedFileChanges` gained two narrow deterministic rules,
  ordered before compile validation:
  `ERR_PROPOSAL_EMPTY_EXECUTABLE_CONTENT` (create/modify of an executable
  source — shared MVP-4L classification via `isExecutableSourcePath` —
  with empty/whitespace-only content; no minimum-length heuristic:
  `export {};` passes) and `ERR_PROPOSAL_NOOP_MODIFY` (proposed modify
  bytes exactly equal current trusted bytes; no normalization; skipped in
  apply-time revalidation so a resumed partial apply is not misread).
  Both codes are repairable inside the existing 3-attempt loop with
  fact-only repair feedback.
- New shared bounded proposal review renderer
  (`apps/designflow-cli/src/services/proposal-preview.ts`, max 120
  lines / 12,000 chars with explicit `[diff truncated — N more lines
  omitted]`): exact LCS line diff for modify (with `changed: +A/-R`
  summary and an explicit warning when proposed content would blank the
  file), bounded content preview + byte size for create, DELETE + size
  for delete. Used by BOTH the implementation approval
  ("Proposed changes (bounded review):", current content resolved from
  the registered root) and the correction approval ("Bounded diff:",
  upgraded from the old 400-char slice to the same renderer). Rendering
  is a pure function of the exact approval-bound proposal payload.
- 15 new focused tests (7 content-integrity, 2 bounded-loop integration
  incl. 3×invalid → typed exhaustion with zero writes, 6 renderer tests
  incl. the destructive-empty-diff fixture). Full regression: build
  26/26, typecheck 44/44, lint 26/26, test 52 tasks — 2,492 pass /
  1 skip / 0 fail; smoke exit 0; freshness exit 0; fresh package
  `6f907dbb…` reinstalled and verified.

### Final Journey 6 attempt (parent `b9d25a93-5989-40e4-ac9a-54042b981b33`)

Baseline `992d7d5` (fingerprint `23c36efd…`); profiles unchanged
(implementation + correction = `z-ai/glm-5.2`, verified per-invocation in
the run record: `profileId implementation-default, model z-ai/glm-5.2`,
1,704 in / 409 out tokens, 9.7s, ≈ $0.0042; coordinator/figma remained
built-in gpt-4o-mini).

- Attempt 1 passed every deterministic gate honestly: structural PASS;
  content-integrity PASS (single non-empty CSS file — not executable);
  compile validation trivially PASS (no executable entries).
- **The new bounded review rendered the complete proposed content inside
  the approval prompt** — the proposal was a single 259-byte
  `src/components/NavMenu/NavMenu.module.css` wrapper stylesheet with
  zero Spendly implementation. The MVP-4M failure mode (innocuous-looking
  prompt) is gone: the emptiness of the work was visible on screen.
- Manual un-scripted quality gate: **rejected** — a lone unimported CSS
  module cannot plausibly become the target Spendly UI.
- Product stopped cleanly: "Rejected. The workflow was stopped. Nothing
  was written to your project." Fixture fingerprint unchanged
  (`23c36efd…`); zero approvals/snapshots/writes; no leftover
  workspaces/processes; no credential leakage.

### Classifications

**MVP-4N: `PASS`** — all 16 criteria hold; both new rules enforced and
tested; the approval UI now shows the exact bounded content; correction
rendering upgraded without regression.
**Journey 6: `FAIL — IMPLEMENTATION_PROPOSAL_REJECTED_QUALITY (irrelevant
single-CSS proposal)`** — per the task contingency this ends
model/profile work entirely. Three consecutive live runs now show the
same shape: luna emitted compile-invalid modules, GLM emitted an empty
modify, then a token-cheap irrelevant fragment. The blocker is the
**Implementation Agent proposal-generation contract** itself: nothing in
the prompt/plan contract requires the proposal to cover the mapped
design surface (e.g. a minimum mapping between specification
frames/components and proposed files). That contract redesign is the
recorded next architectural decision.

## MVP-4O — deterministic implementation coverage contract + final Journey 6 — 2026-08-08

### Product changes (commits `cca9f25`, `4e9487d`)

- **Coverage plan** (host-derived, `coverage.ts`): the selected root frame
  (parentless specification hierarchy node) is always required; reuse-mapped
  design components whose reference resolves to a trusted inspected source
  path join in mapping order, bounded by
  `MAX_IMPLEMENTATION_COVERAGE_TARGETS = 8`; `trustedReusePaths` come only
  from project inspection. The model receives the plan and can never
  redefine it.
- **Claims** (`generatedImplementationSchema.coverageClaims`, optional and
  defaulted so historical artifacts stay readable and are never
  reinterpreted as covered): `proposed_change` paths must be in the exact
  proposal; `existing_reuse` paths must be trusted mapped paths; every
  required target needs an executable primary path (shared MVP-4L
  classification) — a stylesheet alone can never satisfy the root frame.
- **Validation ordering**: structural → content integrity → COVERAGE →
  proposed-state compile → reachability → approval; an uncovered proposal
  never costs a compile workspace. Typed repairable codes
  `ERR_PROPOSAL_COVERAGE_INCOMPLETE` / `ERR_PROPOSAL_COVERAGE_INVALID`
  feed the existing 3-attempt loop with fact-only feedback (targetId,
  targetKind, rule fact).
- **Artifacts/UI**: `implementation-coverage` artifact (plan + claims +
  result, hash-bound to the proposal); the approval prompt now shows a
  "Design coverage:" summary (rebuilt deterministically from the run's own
  persisted evidence with the same derivation code) above the MVP-4N
  bounded diff.
- Contract-alignment fix (`4e9487d`): the strict model response schema now
  mirrors the typed bounds (`paths` minItems 1, claim/array maxima) after
  a live run (`bad6f6fc`) ended `ERR_MODEL_OUTPUT_INVALID` at attempt 3 —
  attempts 1–2 were gate-rejected and the terminal attempt could emit
  claims the zod contract refused; zero writes throughout.
- Tests: 8 coverage-unit tests (plan derivation/provenance, the exact
  MVP-4N CSS-only failure, missing/unknown/fake-reuse/not-in-proposal
  claims, executable-primary rule, supporting stylesheet), 2 bounded-loop
  integration tests (CSS-only → coverage fact → covered attempt 2;
  3 uncovered → typed exhaustion, zero writes), CLI approval assertions
  (coverage summary + bounded review). Full regression: build 26/26,
  typecheck 44/44, lint 26/26, test 52 tasks — 2,502 pass / 1 skip /
  0 fail; smoke 0; freshness 0; fresh package `c86bf461…`.

### Final Journey 6 (parent `9976ba10-9341-4f73-8a2d-9ac274768bed`)

One earlier launch was killed externally at step 1 (zero side effects);
the post-fix run is the acceptance run. Baseline `992d7d5`
(`23c36efd…`); GLM profiles unchanged and proven per-invocation.

- **Implementation**: attempt 1 rejected live by the MVP-4L compile gate
  (`ERR_PROPOSAL_MODULE_COMPILE_FAILED`); attempt 2 passed every gate:
  2 creates (`src/pages/AddExpense/AddExpense.tsx`, 3,881 bytes of real
  composed Spendly UI reusing TextField/PrimaryButton/ExpenseHistoryItem/
  NavigationMenu, + token CSS Module), coverage ✓ (root frame →
  proposed_change AddExpense.tsx; components via trusted existing_reuse),
  compile ✓ (`proposalHash 445f0314…`), reachability honestly
  `UNREACHABLE`. Approval prompt displayed the coverage summary and the
  full bounded diff; manually approved un-scripted. Snapshot → apply →
  required validation passed.
- **Visual stage → correction**: root-frame actionable finding →
  `CORRECTION_ELIGIBLE` → one child (`5fa46a17…`), MVP-4K scope exposed
  `src/App.jsx`; GLM proposed exactly the mount (+2/−47 diff shown at the
  prompt: Northstar out, `<AddExpense />` in; base hash byte-verified);
  manually approved un-scripted; snapshot (incl. App.jsx) → apply →
  **the mounted project passed required build validation live** — the
  MVP-4L promise held end-to-end.
- **Post-correction recapture FAILED environmentally**: the child's fresh
  Stage 5 re-fetch of the Figma reference hit `ERR_MCP_TIMEOUT`
  (Figma Desktop unresponsive) and the child terminated `failed`; the
  parent loop closed `stopped` and refuses resume. Applied state remains
  (validation had passed; no rollback was warranted).
- **Supplementary (non-product, explicitly not a substitute for the
  product recapture)**: a labeled manual preview capture shows the mounted
  page renders BLANK — `NavigationMenu` is invoked without its required
  `items` prop and crashes at runtime (`Cannot read properties of
  undefined (reading 'map')`). Bundler-level compile validation cannot see
  prop contracts; this is precisely the class of defect the visual
  stage/correction iteration 2 would catch, and the one-iteration bound
  plus the recapture failure ended the loop first.

### New recorded debts

1. A Stage-5 infrastructure failure during Stage-6 revalidation
   (`ERR_MCP_TIMEOUT`) crashes the correction child instead of stopping
   honestly with `visual_validation_inconclusive` and a final report.
2. The fixture's own `npm test` (`scripts/validate.mjs`) hard-asserts the
   Northstar page (`App.jsx` must contain "FeatureCard"), so any
   legitimate Spendly mount fails it by construction — fixture debt, not
   product; the product correctly treats `test` as non-required.
3. Compile validation is bundling-level by design; runtime prop contracts
   surface only at the visual stage.

### Classifications

**MVP-4O: `PASS`** — all 19 criteria hold; the live run additionally
proved the compile gate rejecting a real invalid attempt and the
coverage-driven prompt guiding a real, substantial implementation.
**Journey 6: `FAIL — CORRECTION_APPLIED_NO_IMPROVEMENT (runtime prop
crash; post-correction recapture unavailable, ERR_MCP_TIMEOUT)`** — the
deepest Journey 6 run yet: every gate, approval, snapshot, apply, and
validation contract passed live, correction reached and mounted the
implementation, and the two closers are now (a) the revalidation
robustness debt above and (b) runtime component-contract quality, which
belongs to the visual/correction loop that the environment cut short.

## MVP-4P follow-up — runtime-valid correction proposals — 2026-08-08

The MVP-4O runtime defect is represented by a deterministic proposed-state test: a NavigationMenu-style exception occurs after the exact proposed files compile successfully. The new correction gate runs that exact state in the existing temporary workspace, starts the registered preview command, captures with the bounded browser renderer, and rejects `pageerror` before approval. The registered fixture remains unchanged during this phase.

Attempts 1–3 are bounded retries inside correction iteration 1, not additional children or applied iterations. Only a runtime-valid proposal reaches the existing manual interactive approval gate. The approved proposal hash is the same hash preflighted, displayed, bound, snapshotted, and applied. Compile failure prevents runtime preview entirely.

No implementation or correction acceptance run was performed in MVP-4P because the current process lacked `OPENROUTER_API_KEY`. The fixture's applied blank state was recorded and restored to committed `992d7d5`; its independent 7-file validation and Vite build passed. The current inspector returned `97ce9bb0…`; the earlier accepted evidence's `23c36efd…` is retained as historical data.
