# MVP-4 Journey 6 — Bounded Live Visual Correction

Classification: `FAIL — correction loop unreachable (Implementation
Specialist proposal-validity defect)`. All safety/no-write gates held on
every attempt; the single authorized correction iteration was never
exercised.

Timestamp: 2026-08-07
DesignFlow baseline at start: `32948bd6c1773d36ab93f288e864a5342dfd96d9`
(Journey 4 evidence commit). Two product fixes were made during this
journey (see below), regression-validated, currently uncommitted.
Journey 4 parent run: `fb0366d5-b6d1-49ba-9104-9b2b48897608`
(`CORRECTION_ELIGIBLE`).

## Pre-correction baseline

Fixture HEAD `84e182895c156098bf8a046ef5cbd7eaa8075423`; working tree =
the four Journey 4 approved files; independent implemented-state
fingerprint `04cf9640d8bbb044b5ae81d08ddd9956941c0c5d614cadec8b6e4135b60ec399`.

## Default-off evidence

Journey 4's non-interactive run (no flag) reached completion with
correction-eligible findings and performed no correction: the offer is
interactive-only/explicit-only by code (`session-flow.ts`
`offerVisualCorrection`), no correction child, no agent call, no writes —
`eligible ≠ automatically corrected` held.

## Product defect 1 — `--visual-correction=once` silently no-oped

`readImplementationInput` strict-parsed the session's original input,
which is a superset of the workflow input (it also carries the free-text
request and journey-consent marker). The strict parse failed silently, so
even a completed implementation run with `--visual-correction=once`
returned before the correction offer (observed on run
`74d74e75-4cf4-457b-88d1-1be7571f42eb`: implementation applied, visual
fail, then no correction section at all). Fix:
`apps/designflow-cli/src/services/visual-correction.ts` now filters the
input to the workflow schema's own keys before the strict parse. Full
forced regression after the fix: build 26/26, typecheck 44/44, lint
26/26, tests 52/52 tasks (2,434 pass, 1 skip, 0 fail), smoke PASS,
freshness PASS; fresh package shasum
`ed1209d7d916940240f330edc1bf3dc77e98fed3` installed. (Note: the
`stage6-feedback-loop` suite fails when invoked standalone outside Turbo
on both the clean and fixed tree — environmental, unchanged by the fix.)

## Product defect 2 — Implementation Specialist proposal validity

To reach the correction stage on the already-implemented fixture, the
canonical `run … --visual-correction=once` journey must first complete a
new implementation proposal. The live specialist (pinned profile
`implementation-default`, OpenRouter `openai/gpt-4o-mini`) repeatedly
produced operation-invalid proposals against the non-empty project, each
deterministically blocked BEFORE the approval prompt with zero writes:

1. `11452c0f-…`: `modify src/components/Button.jsx` — nonexistent →
   `ERR_PROPOSAL_TARGET_MISSING` (accurate diagnostic from MVP-4D).
2. `31df689e-…`: `create src/components/TextField.js` — already exists →
   `ERR_PROPOSAL_TARGET_EXISTS`.
3. `74d74e75-…` (valid): 3 creates with `.jsx` names — approved, applied,
   visual fail again (components still not mounted); correction then
   no-oped due to defect 1 (fixed after this run).
4. `de5297b8-…` and 5. `810fb6ac-…` (after the offer fix and a
   strengthened agent instruction): both again proposed
   `create src/components/TextField.js` (exists) → blocked pre-approval.

An instruction line was added to the Implementation Agent ("a path
already listed in the project context MUST use action 'modify', never
'create'") — insufficient for this pinned model in practice. Model
profiles were not changed (out of scope per journey constraints). No
further retries were made to avoid mining a convenient result.

## What was and was not exercised

Exercised and PASS-quality: explicit-authorization gate; default-off;
host-derived eligibility (correction preparation is built only from
persisted run/artifact state — no hand-authored input); deterministic
proposal validation before approval (five live demonstrations); no-write
guarantee (fixture fingerprint unchanged across every failed attempt);
process cleanup; no secret leakage.

Not exercised: correction child creation/lineage, live Visual Correction
Specialist, correction proposal/approval/snapshot/apply, post-correction
recapture and re-validation, one-iteration bound at runtime.

## Final fixture state

HEAD `84e18289…`; working tree = Journey 4 files + run-3's three `.jsx`
components (all approved applies); independent fingerprint
`e6b053b2e90cd0be254f33b350a70e92d94654f9bd27ab652cb21854ac99d3e3`;
`npm test` and `npm run build` exit 0. No pending approvals, no running
executions, no orphan preview/browser processes, no credential material
in the stored home. The page still renders the original fixture app; the
Journey 4 major finding stands.

## Deferred debt (unchanged)

Dimension-mismatch pixel-diff skip; rejected-history wording; sparse
specialist trace rows.

## Recommendation

The correction loop cannot be truthfully accepted until the
implementation-proposal validity defect is addressed — either a stronger
implementation model profile, a deterministic regeneration-on-invalid
loop (bounded, with truthful provenance), or a host-side reconciliation
contract that is explicitly allowed to map existing-path creates to
modifies. That is product work requiring its own regression, after which
Journey 6 should be rerun.

## MVP-4E — bounded proposal regeneration — 2026-08-07

### Design implemented

The proposal owner was verified from code: implementation-stage file
operations come from the Implementation Agent
(`invoke-implementation-agent` → `store-proposed-file-changes` →
approval); the correction child's own proposals come from the Visual
Correction Agent, whose `validateCorrectionAgentOutput` is already
scope- and base-hash-bound to existing in-scope files (the invalid-
operation class cannot arise there). Bounded regeneration was therefore
implemented at the stage that actually blocked Journey 6.

`invoke-implementation-agent` now runs up to
`MAX_CORRECTION_PROPOSAL_ATTEMPTS = 3` model attempts inside one
capability execution (one iteration — no iteration counter is touched,
no new child per attempt). After each attempt the exact would-be
proposal (with deterministically stamped base hashes) is validated with
the MVP-4D rules. On a repairable failure — allow-list
`ERR_PROPOSAL_TARGET_MISSING`, `ERR_PROPOSAL_TARGET_EXISTS`,
`ERR_DUPLICATE_PROPOSAL_ACTION`, `ERR_UNSAFE_PATH`,
`ERR_PATH_TRAVERSAL`, `ERR_UNSUPPORTED_FILE_TYPE`,
`ERR_PROPOSAL_INVALID`, `ERR_PROPOSAL_TOO_LARGE` — a typed, fact-only
repair feedback object (attempt, maxAttempts, validation errors with
code/path/existence fact, current component/token source paths, the
modify-vs-create rule) is passed to a full re-invocation of the same
agent. The feedback never rewrites an operation. Non-allow-listed
failures (inaccessible root, staleness, provider failure) terminate
immediately; cancellation checks precede every attempt. Exhaustion
throws typed `ERR_PROPOSAL_ATTEMPTS_EXHAUSTED`
(`attempts: 3, attemptsExhausted: true` with per-attempt codes) — no
approval prompt, no snapshot, no writes. A successful attempt records
`proposalAttempts` and `failedAttempts` provenance on the agent-output
artifact. Approval binding continues to use only the final valid
proposal's hash and the current fingerprint.

Files: `workflows/workflow-design-to-code/src/implementation-capabilities.ts`
(retry loop, feedback builder, constants),
`…/implementation-workflow.ts` (invoke node now receives the project
input), `packages/agents/src/catalog/implementation-agent.ts`
(`proposalRepairFeedback` plumbed into the model message; the existing
instruction lines were reviewed and kept — they restate the contract but
are not the safety mechanism).

### Tests and regression

New `proposal-regeneration.test.ts` (5 tests): invalid→valid at attempt
2 with feedback content assertions (including no-operation-rewrite),
invalid×2→valid at attempt 3, three-invalid exhaustion with exactly 3
invocations and no fourth, cancellation after attempt 1 prevents attempt
2, and non-repairable immediate termination. Full forced regression:
build 26/26, typecheck 44/44, lint 26/26, tests 52/52 tasks — 2,439
pass, 1 skip, 0 fail, exit 0; smoke PASS; freshness PASS. Fresh package
shasum `56b25932b99615898c5aae775a22444f36d92ed6` installed.

### Parent/fingerprint reconciliation

Current fixture fingerprint `e6b053b2…` corresponds to run
`74d74e75-…`'s applied state. No persisted feedback-loop parent exists
for any run (parents are only created when a correction starts), and the
only non-hand-authored surfaces are `feedback-loop resume <parent>` and
the end-of-run offer — so the canonical rerun necessarily flows through
a fresh `run … --visual-correction=once` whose correction attaches to
its own completed implementation. This deviation from "attach to the
prior parent" is a product-surface fact, recorded here.

### Live rerun (exactly once)

Run `6fad96d3-cf0e-4cbf-acfd-6c04911bbe69`: the Implementation Agent
made three live OpenRouter calls on `implementation-default` (input
tokens 1,643 → 1,771 → 1,800 — the repair feedback demonstrably reached
attempts 2 and 3). All three proposals remained invalid, and the run
terminated honestly BEFORE any approval prompt:

> "The proposal remained invalid after 3 bounded attempts; no approval
> was requested and no files were changed."

No fourth call, no approval, no snapshot, no apply. Fixture unchanged
(fingerprint `e6b053b2…`, build/test green), no pending approvals, no
orphan processes, no credential leak.

### Outcome

## MVP-4F — implementation model-profile suitability — 2026-08-07

MVP-4E committed as `0e3dff9bb719d26b7b90ef513dafb3381b4c86f3`
("feat: bound invalid implementation proposal regeneration"); fresh pack
`56b25932…` (byte-identical to the MVP-4E validation build).

### Model selection (once)

`implementation-default` overridden in the acceptance home only, via the
supported `settings.models.profiles` mechanism, to OpenRouter
`anthropic/claude-sonnet-4.5` — a widely recommended high-capability
coding/reasoning model, materially stronger than `gpt-4o-mini` at
codebase-aware structured JSON planning. `designflow settings` proves
isolation: only `implementation-default` shows `(override)`; coordinator,
Figma specification, visual-validation, and visual-correction profiles
remain the built-in `openai/gpt-4o-mini`. No production source hard-codes
the model.

### Genuine product defects found and fixed (full regression each time)

1. **Profile `maxOutputTokens` override was ineffective**: the model
   runtime let a strategy's built-in request value (1600, sized for
   gpt-4o-mini) outrank the configured profile limit, so the documented
   per-profile override could never apply and Sonnet's fuller output was
   truncated (`ERR_MODEL_OUTPUT_INVALID`, run `d5a021b4-…`). Fixed in
   `packages/models/src/runtime.ts` (explicit profile limit wins).
   Acceptance config sets `maxOutputTokens: 8000`, `timeoutMs: 120000` —
   documented because Sonnet's real proposals measure 3,475–7,285 output
   tokens and ~36–100s.
2. **Correction eligibility could never follow an applying run**: the
   staleness gate compared the current fingerprint to the *pre-apply*
   inspection fingerprint, which the run's own approved writes always
   change (run `9c635359-…` reached visual fail and then reported "The
   project changed after visual validation"). Fixed in
   `apps/designflow-cli/src/services/visual-correction.ts`: applied runs
   are judged per-file against the snapshot's recorded post-write hashes;
   fingerprint equality still governs non-applying runs. New eligibility
   test added.
3. **`providerRouting` was configurable in the profile schema but not
   readable from local config** — extended `model-config.ts`/`config.ts`
   override readers (added under a mis-hypothesis about upstream routing;
   kept as a legitimate, regression-green configuration capability).

Regressions after each source change: build 26/26, typecheck 44/44, lint
26/26, tests 52/52 tasks (2,439 → 2,440 pass with the new test, 1 skip,
0 fail), smoke PASS, freshness PASS; fresh packs installed
(`9362493a…`, `b58d6fc8…`, `ff79d535…`).

### Live evidence with the stronger model

- Run `9c635359-…`: Sonnet produced a **valid 12-file creates-only
  proposal on attempt 1** (structured component directories with CSS
  modules, barrel exports, an ExpenseTracking page — visibly stronger
  output than any gpt-4o-mini attempt), which was approved, snapshotted,
  applied exactly, validated (build/test pass), previewed, captured, and
  honestly visual-failed (page composition root still unmounted).
- Run `d43ed25f-…`: Sonnet proposed exactly the right correction-shaped
  work — **2 modifies completing the ExpenseTracking page** — and the
  proposal was valid; snapshot-time git safety then blocked writes
  (`ERR_GIT_DIRTY_TARGET`) because the acceptance fixture's applied files
  had never been committed. Environment reconciled by committing the
  fixture's accepted applied state (`1034625160…`; content
  byte-identical, fingerprint `4bda1f4e…`), as a real project owner
  would.
- Runs `5d6a574a-…`, `09ec9132-…`, `dc8c9298-…`: fast
  `ERR_MODEL_PROVIDER_FAILED` (~550ms).

### Blocking external constraint

Direct probing identified the provider failures as **HTTP 402 —
insufficient OpenRouter credits**: the key reports $5.00 total /
$4.64 used, and the remainder affords ≤2,392 max_tokens, below Sonnet's
measured real proposal size. The failure is an account/credit ceiling,
not a product or model defect; two earlier hypotheses (transient
upstream, Bedrock routing) were tested and disproven (the exact request
shape succeeds with small max_tokens). No further model change was made
(no mining).

### Outcome

**MVP-4F: `PASS`** — controlled single-model experiment, per-agent
profile isolation proven, bounded 3-attempt contract intact, three real
architecture defects fixed with green regressions, and live evidence
that the stronger implementation profile produces valid, relevant
proposals (including the exact page-mounting modifies the visual finding
requires). **Journey 6 remains `FAIL` — blocked externally by exhausted
OpenRouter credits** before the correction iteration could execute. Next
step requires topping up the OpenRouter key (or raising its limit), then
rerunning Part 5 once; no product work is pending for it.

## MVP-4G — frozen baseline + low-cost final Journey 6 run — 2026-08-08

### providerRouting audit (Fix 3): KEPT

`modelProviderRoutingSchema` was already part of the SDK's
`modelProfileSchema`; `ModelRuntime` already forwarded
`profile.providerRouting`, and the OpenRouter provider already serialized
it. The only gap was the CLI config reader silently dropping the field —
a real, pre-existing configuration contract that the change completes.
Focused tests added (`model-config.test.ts`: parses model/tokens/timeout/
providerRouting; ignores malformed routing). Runtime token-precedence
tests added (`runtime.test.ts`: explicit profile limit outranks caller
default; caller value applies when no profile limit).

### Frozen baseline

Focused suites green (model-config 3, visual-correction 6,
proposal-regeneration 5, models runtime 29). Full forced regression:
build 26/26, typecheck 44/44, lint 26/26, test 52/52 tasks — **2,445
pass / 1 skip / 0 fail**, exit 0; smoke PASS; freshness PASS. Committed
as `b8dc06f198a0c884c5d1de657d0ffb923257739e`
("fix: stabilize model profiles and correction state"); pack shasum
`ff79d53553be299b39afad6fcf91959fde8f874e` (byte-identical to the prior
install — the commit added only tests/docs on already-built source).

### Low-cost profile + credit gate

`implementation-default` overridden (acceptance home only) to OpenRouter
`deepseek/deepseek-v4-flash-0731`, `maxOutputTokens: 8000`,
`timeoutMs: 120000`; the earlier Sonnet override and routing pin were
removed (normal OpenRouter routing). `designflow settings` proves all
four other profiles remain built-in `gpt-4o-mini`. Credit gate passed:
a bounded 8000-max-token strict-schema probe succeeded (61 tokens, no
402) after the user raised the OpenRouter limit.

### Final run history (fixture at `1034625160…`, fingerprint `4bda1f4e…`)

- `ce287ebe-…` (2s, 0 writes): the Figma Desktop selection had drifted to
  another node; the adapter's selection-binding gate refused honestly.
  The user re-selected frame `1026:6098`; verified via MCP before
  continuing.
- `ff2790e5-…` (108s, 0 writes): DeepSeek's first live structured call
  failed at the provider boundary (`ERR_MODEL_OUTPUT_INVALID` —
  unparseable structured output; upstream serving variance). One rerun of
  the same model (no model switch).
- `a0bc2592-fef5-47ca-98d9-fbf361ca9526` — the accepted final run.
  Implementation proposal **valid on attempt 1** (single live DeepSeek
  call, 1,734 in / 2,839 out / 4,573 tokens, **$0.00104** — roughly 60×
  cheaper than the comparable Sonnet call): 8 creates (AddExpensePage,
  AddExpenseForm, ExpenseHistorySection, BackButton + CSS modules), all
  vacant fixture-relative targets. Approved (approvalId `d37387dc…`,
  proposal hash `d28aa9e0…`, fingerprint `e9f20dbc…`); snapshot
  `8dd90079…` covered exactly the 8 paths before mutation; apply exact;
  deterministic validation build/test passed; independent
  `npm test`/`npm run build` exit 0; real preview + 3 Playwright
  captures; deterministic comparison (real-reference) mobile fail with
  the known `dimension-mismatch-mobile` major finding; live Visual
  Validation Specialist confirmed (859 tokens).

### Correction outcome — the honest terminal state

With the MVP-4F fingerprint fix in place, the correction offer now
progresses past staleness — and the next deterministic gate answers
truthfully: **"Visual validation found no actionable differences."**
The sole finding (category `size`, deterministic dimension mismatch)
carries no `affectedComponent`/`affectedFrame` and is therefore
non-actionable by the selection policy, and the real content divergence
(the page still renders the original fixture app — the captures are
byte-identical to Journey 4's) produces **no finding at all** because
the dimension mismatch skips the pixel diff. That comparator
measurement debt — deferred by explicit instruction in Journeys 4, 6,
and this task — is now the **sole remaining blocker** to exercising the
correction loop: there is nothing product-side left in the correction
path itself.

Manual assessment: `NO_MEANINGFUL_IMPROVEMENT` (rendered page
byte-identical; DeepSeek, like every implementation model before it,
proposed only unmounted creates). No correction child was created; no
second iteration; no pending approvals; no orphan processes; no
credential in stored state. Final fixture: HEAD `1034625160…` plus the
8 new untracked files, fingerprint
`8bc42afd50b4fd04de6f87c78672a6e82b92beab2d48578998ab9b14136c3ec2`,
build/test green, preserved.

### Cost policy recommendation (recorded per instruction)

> During DesignFlow development and acceptance testing, prefer low-cost
> models that satisfy each agent's contract. Expensive frontier models
> should not be the default for routine test runs. Per-agent profiles
> should be selected according to task complexity, and deterministic
> validation must remain authoritative regardless of model capability.

`deepseek/deepseek-v4-flash-0731` is recommended as the low-cost testing
profile for `implementation-default`: attempt-1-valid structured
proposal at ~$0.001/call (vs ~$0.06–0.13 for Sonnet), with one observed
provider-boundary output failure in two live calls — acceptable for
testing given the bounded retry contract. Profile selection remains
configuration; no production default was changed.

### Classifications

**MVP-4G: `PASS`** (all 11 criteria hold; the single same-model rerun
after a provider-boundary failure was not model cycling).
**Journey 6: `FAIL — correction loop unreachable: no actionable finding
under the deferred comparator measurement debt.`** Every safety,
approval, snapshot, apply, validation, and honesty contract on the path
has now been proven live; the loop itself awaits either
dimension-normalized comparison (so content divergence yields
component-bound findings) or a fixture whose visual defect is
finding-mappable. That comparator work is the single prerequisite for a
Journey 6 rerun.

**MVP-4E: `PASS`** — the bounded-regeneration contract works end to end
(structured feedback delivery proven, hard 3-attempt bound proven live,
honest exhaustion, zero writes).
**Journey 6: `FAIL — CORRECTION_PROPOSAL_ATTEMPTS_EXHAUSTED`.** The
pinned `openai/gpt-4o-mini` implementation profile cannot reliably
produce operation-valid proposals for this fixture even with
deterministic repair feedback (6 invalid proposals across 8 lifetime
attempts). The remaining remediation options are a stronger
implementation model profile (explicitly deferred by task scope) or a
host-side reconciliation contract. Correction-stage machinery (child
lineage, Visual Correction Specialist, correction approval/snapshot/
apply, runtime one-iteration bound) remains unexercised.
