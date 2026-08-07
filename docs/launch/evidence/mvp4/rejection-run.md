# MVP-4 Journey 3 — Live Implementation Proposal Rejection

Classification: `PASS`

Timestamp: 2026-08-07
DesignFlow commit: `837fa9c6725b9d0c6817d74af29e0ae5edbee796`
Package version: `0.1.1` (fresh MVP-4B/4C build, shasum `21e9bd793a0cb8700395e9615e724dccdb601443`)
Acceptance home: `/tmp/designflow-mvp4-acceptance-home`
Disposable project: `/tmp/designflow-mvp4-acceptance-project`
Registered project: `mvp4-acceptance` (`696d56a7-9281-4354-840e-4c713ac6f3b7`)
Run id: `1642b74a-a0ae-48b4-9cda-c5caef5165b5`

## Preconditions

- `OPENROUTER_API_KEY`: present (value not inspected)
- Figma Dev Mode MCP Server reachable on localhost HTTP, protocol `2025-03-26`
- Resolved CLI: `/Users/wallex/.local/bin/designflow` →
  `…/node_modules/designflow-ai/dist/main.js`, `DesignFlow 0.1.1`

## Pre-run project baseline

- HEAD: `84e182895c156098bf8a046ef5cbd7eaa8075423`; clean status; empty diff
- Independent content fingerprint (sha256 over sorted per-file sha256 of
  `src`, `index.html`, `package.json`, `vite.config.js`):
  `c2ad656d7e15f23fea5ebea9e1a69039839893340eef107ff50eaf981c299c51`
- Product fingerprint (recorded by inspection):
  `8ba1190204f81dbaf1df28a0c22c3805d4c3489b014f2fff6dd4ad7ad7753e68`
- Pre-run `npm test`: exit 0 (7 fixture files validated); `npm run build`:
  exit 0 (`dist/` is gitignored)

## Canonical run

`DESIGNFLOW_HOME=… designflow run design-engineer --project 696d56a7-…`
with explicit implementation intent ("Implement this Figma design in the
registered MVP-4 acceptance project… do not write anything until I approve
the exact proposal"), the Spendly URL/node `1026:6098`, no frames.

Journey consent prompt appeared separately — "Prepare implementation changes
for \"mvp4-acceptance\"? … nothing is written until you approve that exact
proposal. Prepare changes for this project? [yes / no]" — answered `yes`.
This authorized proposal preparation only.

## Live coordinator

Trace (run-bound): role "Design Engineer", live OpenRouter
`openai/gpt-4o-mini`, profile `design-engineer-coordinator-default`,
success, 762 tokens — selected the implementation route (run executed the
23-step "Design → Code (Implementation)" workflow, not specification-only).
An adjacent coordinator trace shows a live `declined` decision (458 tokens)
from the same profile; no specification-only path was taken.

## Figma evidence

The workflow re-retrieved the design through MCP inside the run: the stored
snapshot carries the corrected rich evidence (real text such as
"Add Transaction", hierarchy, fills, layout facts — same normalization path
validated in Journey 2). The Figma Specification Specialist ran live
(OpenRouter `openai/gpt-4o-mini`, profile `figma-specification-default`,
success, 5,863 tokens — rich-evidence-scale input) and its specification fed
the implementation stages. No URL/node-only regression.

## Project inspection (deterministic step)

`project-implementation-context` artifact: framework react 18.3.1,
language javascript, npm, source root `src`, styling `css`, token source
`src/styles.css` (7 CSS custom properties, e.g. `--ink: #18212f`),
conventions (PascalCase components, files under `src`, preserve export
style), commands build/test/preview from package scripts, no warnings.
Presented as "Inspecting the registered project (deterministic step)" — not
an agent.

Discrepancy (quality, non-blocking): the fixture's reusable components
`src/components/FeatureCard.jsx` and `src/components/PrimaryButton.jsx`
were not listed in the inspection's component inventory (empty), which
limited reuse downstream.

## Design-system mapping (deterministic step)

`design-system-mapping` artifact: token mappings for the real design palette
(white, #ececec, #f9f9f9, #e4e4e4, #cacaca, #0000001a, #00000005, #707070)
all `create` at confidence 0 (no exact project token match — the fixture
tokens use different values); component mappings: "Button" → 0.6
`manual-review` ("possible match exists below the safe reuse threshold"),
Text field / Expense History Item / Navigation menu v3 → `create` (no
reusable match). Mapping decisions are recorded and honest; reuse quality is
limited by the empty component inventory above.

## Live Implementation Specialist

Trace: live OpenRouter `openai/gpt-4o-mini`, profile
`implementation-default`, success, 1,955 tokens. Consumed the
specification, project inspection, and mapping (artifact dependency chain
records all three). Produced typed artifacts: `implementation-agent-output`,
`implementation-plan`, `proposed-file-changes`.

## Exact proposal

`proposed-file-changes`: 3 creates + 1 modify, no deletes, no package
changes; `baseProjectFingerprint` `8ba11902…`; validation commands
requested: build (required), test, preview.

- modify `src/components/Button.js` — align Button with the design
- create `src/components/TextField.js`
- create `src/components/ExpenseHistoryItem.js`
- create `src/components/NavigationMenu.js`

Scope assessment: every path is inside the fixture's `src/components/`; no
repository-external, DesignFlow-source, home-directory, secret, or
package-manager mutation. Quality assessment: changes correspond to real
Spendly components (Text field, Expense History Item, Navigation menu);
contents are small readable stubs; the proposal itself records the Button
low-confidence match under `unresolvedItems`. Discrepancies (non-blocking):
the modify targets `src/components/Button.js`, which does not exist in the
fixture (the real file is `PrimaryButton.jsx`), a consequence of the empty
component inventory; existing tokens/components are not reused.

## Approval boundary

`implementation-approval` artifact binds the approval to the exact state:
approvalId `27dbfc8cf4d8664022a23020`, `proposalArtifactId
proposed-file-changes`, `proposalHash 75ba4ae13b29cd4ee90452364506fe9f5dc8a91c9977b4a4b8bd6b2210032ba4`,
`baseProjectFingerprint 8ba11902…`, 30-minute expiry. The CLI presented a
distinct exact-approval prompt ("DesignFlow wants permission to apply the
proposed implementation… Files to create: 3 / Files to modify: 1 … No files
have been changed yet. … Approve? [approve / reject]") — clearly separate
from the earlier journey consent.

## Rejection

Answered `reject`. Output: "Rejected. The workflow was stopped. … You
rejected the proposed changes. Nothing was written to your project.
Everything produced before the approval is still stored as artifacts." No
apply, no post-write validation, no rollback, no Playwright preview, no
correction offer.

## Independent no-write proof

After rejection: HEAD `84e182895c156098bf8a046ef5cbd7eaa8075423`, clean
status, empty diff, no untracked implementation files. Independent content
fingerprint re-computed: `c2ad656d…` — identical to baseline.
Post-rejection `npm test` exit 0 and `npm run build` exit 0.

## Artifacts / traces / history

Artifacts present: design source (2), design specification, project
analysis (inspection + mapping), implementation (agent output, plan,
proposed changes), approval binding. Absent, as required: applied
implementation, post-write validation, visual result, correction iteration.
Traces: coordinator, specification specialist, and implementation
specialist all live OpenRouter with independent profiles; deterministic
steps labeled as steps. `designflow sessions`: nothing waiting; no pending
approval; no child correction run.

Minor presentation discrepancies (non-blocking): history lists the rejected
run as `failed · did not finish` rather than a distinct "rejected" outcome
(the run summary itself is truthful); the implementation-specialist trace
row omits the Role/Run-id display fields that other rows show.

## Security/privacy

No credential values, auth headers, environment values, or raw provider
responses in the stored home (grep for the key value and header patterns:
no matches). All proposal paths are fixture-relative. No unrelated private
Figma payloads beyond the selected frame's evidence.

## Result

All 14 PASS criteria hold. Journey 3: `PASS`. Journey 4 (approved
application) was not started, and no second proposal was approved.

## MVP-4D — inspection and proposal path integrity — 2026-08-07

### Evidence correction

The Journey 3 record above claimed the component inventory was empty. That
was an evidence-reading error in this document, not a product defect: the
components live under `designSystem.components` in the
`project-implementation-context` artifact, and the Journey 3 run's stored
artifact already contained both `FeatureCard`
(`src/components/FeatureCard.jsx`) and `PrimaryButton`
(`src/components/PrimaryButton.jsx`). The inspector's source filter always
accepted `.js/.jsx/.ts/.tsx`, and the mapper did see the inventory — its
"Button → 0.6 manual-review" decision was precisely a below-threshold match
against `PrimaryButton`. Regression tests were still added to pin `.jsx`,
`.js`, and `.tsx` discovery and mapper visibility
(`packages/capabilities/implementation/src/implementation.test.ts`).

### Real defect and fix — proposal operation/path integrity

Confirmed root cause: the deterministic `store-proposed-file-changes`
capability assembled the proposal artifact from the Implementation Agent's
plan without host validation and without stamping `expectedBaseHash`, and
`validateProposedFileChanges` had no existence semantics — so
`modify src/components/Button.js` (nonexistent) was presented for approval.
Validation previously ran only at post-approval snapshot/apply time.

Fix:

- `packages/capabilities/implementation/src/proposal.ts`: existence
  invariants — `modify`/`delete` targets must exist as regular files,
  `create` targets must not (typed `ERR_PROPOSAL_TARGET_MISSING` /
  `ERR_PROPOSAL_TARGET_EXISTS`), checked before the base-hash requirement
  so the diagnostic names the real problem; existing path-safety,
  traversal, duplicate, and size rules unchanged. Apply-time revalidation
  passes `checkTargetExistence: false` because a resumed partial apply
  legitimately finds its own written files — apply keeps its per-file
  snapshot/staleness guards, so hashes are not weakened.
- `workflows/workflow-design-to-code/src/implementation-capabilities.ts`
  (`store-proposed-file-changes`): now receives the workflow's project
  input, stamps `expectedBaseHash` deterministically via `projectFileHash`
  for real modify targets, and calls `validateProposedFileChanges` BEFORE
  the approval step — an invalid proposal fails the run with a typed error
  and is never presented as approvable. No silent modify→create rewriting.
- `packages/agents/src/catalog/implementation-agent.ts`: one instruction
  line added (proven contract mismatch): `modify` only for paths listed in
  the project context; new files must be `create` with a relative path.

Tests added: full create/modify/delete existence matrix, duplicate
conflicting operations, `.jsx`/`.js` inventory, mapper visibility (exact
`PrimaryButton` design name → `reuse` at confidence 1), and apply-resume
tolerance. Focused: capability-implementation 30/30, workflow-design-to-code
94/94, agents 229/229.

### Full regression (final source)

build 26/26, typecheck 44/44, lint 26/26, test 52/52 tasks — 2,434 pass,
1 skip, 0 fail, exit 0 (all forced); smoke PASS; freshness PASS. Fresh
package `designflow-ai@0.1.1` shasum
`945fa2c23f2578ba86b689345718971308fb0772` installed to
`/Users/wallex/.local`.

### Live proposal/rejection recheck

Three live runs against Spendly `1026:6098` with project
`mvp4-acceptance`, journey consent yes, no approval:

1. `abf7f877-…`: agent again proposed `modify src/components/Button.js`;
   the new gate stopped the run BEFORE the approval prompt ("Modified file
   lacks an expected base hash") with zero writes — proving criterion 4.
2. `455d07b1-…`: agent proposed absolute `/src/components/Button.js`;
   blocked pre-approval by the path gate (`ERR_UNSAFE_PATH`), zero writes.
3. `ca9cdfed-3499-4618-ac22-0228a326be1c` (after the one-line agent
   instruction fix): structurally valid proposal — creates only
   (`src/components/TextField.js`, `ExpenseHistoryItem.js`,
   `NavigationMenu.js`), no modifies, every create target vacant, all
   paths inside the fixture, bound to fingerprint `8ba11902…` and proposal
   hash `bfb2274d…`; inspection inventory contained `FeatureCard` and
   `PrimaryButton`; mapping again recorded Button → 0.6 manual-review
   (mapper sees the inventory; the agent honestly did not modify a file it
   could not match above threshold). The exact proposal was **rejected**;
   the run stopped with "Nothing was written to your project."

### No-write proof

After all three runs: HEAD `84e182895c156098bf8a046ef5cbd7eaa8075423`,
clean status, empty diff; independent content fingerprint `c2ad656d…`
identical to baseline; fixture `npm test` and `npm run build` exit 0. No
pending approvals; no credential material in the stored home.

**MVP-4D: `PASS`.** Journey 4 remains unstarted.
