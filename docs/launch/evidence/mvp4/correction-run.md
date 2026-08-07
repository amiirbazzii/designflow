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
