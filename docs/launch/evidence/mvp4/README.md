# MVP-4 real-environment evidence

Audit date: 2026-08-07

This directory contains redacted MVP-4 acceptance evidence. MVP-4A prepared a
fresh isolated DesignFlow home and a clean disposable Git/frontend fixture.
MVP-4A.1 verified flag-free flagship readiness: the two legacy Design Engineer
experimental keys are absent, while the valid Figma MCP configuration still
provides canonical specification and implementation readiness. Readiness passes
with the expected warning that doctor does not start a Figma protocol session.

MVP-4 Journey 2 was stopped before workflow execution because the configured
Figma MCP server reported that the active tab was not a design or FigJam file.
A bounded local MCP discovery session was initialized to diagnose the source
and closed successfully; no DesignFlow workflow Figma session, OpenRouter
request, specification workflow, browser acceptance journey, or project write
was completed. The Journey 2 retry reproduced the same preflight blocker before
the CLI was started. Journeys 3–9 remain unexercised.

The provided Spendly URL later passed MCP preflight and read-only node access,
but the canonical run fell back to the generic deterministic `Design → Code`
pipeline with zero model calls. This remains a blocking Journey 2 failure.

MVP-4B identified this as a canonical dispatch defect, not an environment
limitation. The current source has been remediated and passed focused and forced
regression validation; the generic workflow is now compatibility-only and
cannot be selected through the public Design Engineer command. The fresh live
Journey 2 rerun remains pending because the current execution environment lacks
the environment-provided OpenRouter credential required to prove live model
provenance. The initial Journey 2 classification remains `FAIL_BLOCKING` until
that rerun completes. Journeys 3–9 remain unexercised.

The acceptance home remains at `/tmp/designflow-mvp4-acceptance-home` and is
kept for the next authorized journey. Its config has no legacy
`settings.experimental.designEngineerFigmaMcp` or
`settings.experimental.designEngineerImplementation` key. No secret-bearing
configuration was copied or stored.

Secrets, environment dumps, raw provider responses, and private screenshots
must not be stored here.

MVP-4B.1 reconciled the full-test record: a doctor-test fixture changed Figma
settings after composition, and direct `run` could receive a menu-only artifact
prompt in a TTY. Both narrow regressions are fixed. Forced validation now
passes (52/52 Turbo test tasks; 2,414 pass, 1 skip), as do smoke and freshness.
No live acceptance journey ran; the current process lacks the OpenRouter
credential required for a truthful Journey 2 rerun.

With `OPENROUTER_API_KEY` present, Journey 2 was rerun against a freshly
rebuilt and reinstalled CLI. Canonical dispatch, live coordinator, live
Figma Specification Specialist, typed artifact production, and the no-write
guarantee all passed with real OpenRouter provenance. The run still fails
acceptance: the normalized Figma evidence persisted by the deterministic
source-parsing step collapses to URL/node identity only — empty
`childIds`/`fills`/`variables`/`components`/design tokens — even though a
manual `get_design_context` call against the same live MCP session for the
same node returns substantial real hierarchy, styling, and component detail.
Journey 2 is classified `FAIL_BLOCKING`; Journeys 3–9 remain unexercised. See
`specification-run.md` for the full record.

MVP-4C located and fixed the normalization defect: the Desktop adapter
discarded the `get_metadata` outline tree, dropped the `get_design_context`
result entirely, and never parsed the JSON-in-text variable definitions. New
deterministic parsers for both real response shapes, honest merge semantics,
JSON variable parsing, component references from instance nodes, and an
`ERR_FIGMA_EVIDENCE_INSUFFICIENT` floor were added; the typed snapshot
contract is unchanged. After full forced regression (52/52 test tasks; 2,430
pass, 1 skip), a freshly packed and installed CLI reran Journey 2 live: the
snapshot now carries 40 nodes, 7 real text nodes, 14 styled nodes, 16
component references, and 5 variables, and the live specialist consumed the
rich evidence. **Journey 2 is now `PASS`.** Journeys 3–9 remain unexercised.

Journey 3 (live implementation proposal rejection) then ran against the
registered `mvp4-acceptance` fixture: live coordinator selected the
implementation route, the workflow consumed the rich Figma evidence,
deterministic project inspection and design-system mapping ran read-only,
the live Implementation Specialist produced a concrete 4-file proposal
confined to the fixture's `src/components/`, the exact-approval prompt
(hash- and fingerprint-bound, distinct from journey consent) was answered
`reject`, and independent Git/fingerprint/build/test checks proved zero
project mutation. **Journey 3 is `PASS`** with non-blocking quality notes
(component inventory missed the fixture's `.jsx` components; history labels
the rejected run `failed`). See `rejection-run.md`. Journeys 4–9 remain
unexercised.

MVP-4D corrected the record and the real defect. The "empty `.jsx`
inventory" was an evidence-reading error — the Journey 3 artifact already
contained FeatureCard and PrimaryButton, and the mapper saw them; pinning
tests were added anyway. The real defect was proposal integrity: the host
stored and presented model proposals without validating operation
semantics. `validateProposedFileChanges` now enforces modify/delete-must-
exist and create-must-not-exist with typed errors, and the deterministic
`store-proposed-file-changes` step stamps real base hashes and validates
BEFORE the approval prompt; apply-time revalidation stays resume-tolerant
without weakening hashes. Live rechecks proved both sides: two runs with
invalid model output (phantom relative and absolute `Button.js` modifies)
were stopped before approval with zero writes, and after a one-line agent
instruction correction a third run produced a valid creates-only proposal
that was rejected at the exact-approval prompt. Project remained
byte-for-byte unchanged throughout. **MVP-4D is `PASS`.** Journeys 4–9
remain unexercised.

Journey 4 then exercised the full approved-write path against the committed
MVP-4D baseline (`e65777e1…`): live coordinator → rich Figma evidence →
inspection/mapping → live Implementation Specialist → deterministically
validated 4-create proposal → hash/fingerprint-bound exact approval →
pre-write snapshot → apply (exactly the approved files) → deterministic
project validation (build/test pass) + independent build/test pass → real
preview + Playwright captures (3 viewports) → deterministic pixel-diff
comparison (real-reference) → live Visual Validation Specialist → typed
report with an honest **fail** verdict (1 major: mobile dimension
mismatch). Manual review found the deeper actionable gap: the created
components were never mounted in `App.jsx`, so the page still renders the
original fixture app — DesignFlow truthfully reported fail, so there is no
false clean pass. No orphan processes, no secrets, no unauthorized paths;
the implemented state is preserved for later correction acceptance.
**Journey 4 is `PASS`; the run is `CORRECTION_ELIGIBLE`.** See
`implementation-run.md` and `visual-run.md`. Journeys 5–9 remain
unexercised; no correction run was started.

Journey 6 (bounded visual correction) could not be truthfully passed. Two
product defects surfaced: `--visual-correction=once` silently no-oped
because the correction-offer path strict-parsed a superset session input
(fixed, full regression green, fresh package installed), and the pinned
`openai/gpt-4o-mini` Implementation Specialist repeatedly produced
operation-invalid proposals against the now non-empty fixture (phantom
modify targets, creates colliding with existing files) — every one
deterministically blocked before approval with zero writes, across five
live attempts. One attempt produced a valid proposal and applied three
more (still unmounted) components, but its correction offer hit the
then-unfixed no-op bug. The correction iteration itself — child lineage,
Visual Correction Specialist, correction approval/snapshot/apply — was
therefore never exercised. **Journey 6 is `FAIL` (safety held; objective
unmet).** See `correction-run.md` for the defect analysis and the
recommended path to a rerun.

MVP-4E then implemented bounded proposal regeneration: up to 3 model
attempts inside one iteration, deterministic MVP-4D validation after each,
typed fact-only repair feedback between attempts (never a rewritten
operation), a strict repairable-error allow-list, cancellation-aware, with
typed exhaustion (`ERR_PROPOSAL_ATTEMPTS_EXHAUSTED`) and attempt
provenance. Five new tests; full regression 2,439 pass / 1 skip / 0 fail;
fresh package `56b25932…`. The single authorized Journey 6 rerun proved
the mechanism live — three OpenRouter attempts with feedback demonstrably
delivered (growing input tokens), honest exhaustion before any approval,
zero writes — but the pinned `openai/gpt-4o-mini` profile still produced
no valid proposal. **MVP-4E is `PASS`; Journey 6 remains
`FAIL — CORRECTION_PROPOSAL_ATTEMPTS_EXHAUSTED`.** A stronger
implementation model profile (deferred) or a contracted host-side
reconciliation is required before the correction loop can be exercised.

MVP-4F ran the controlled model-profile experiment: `implementation-default`
alone overridden to OpenRouter `anthropic/claude-sonnet-4.5` (isolation
proven via `designflow settings`). The stronger model immediately produced
valid, materially relevant proposals — a 12-file structured implementation
that was approved/applied/validated, then the exact 2-modify page-mounting
correction the visual finding requires. Three genuine architecture defects
surfaced and were fixed with green full regressions each time: the profile
`maxOutputTokens` override could never take effect (runtime precedence),
correction eligibility could never follow an applying run (pre-apply
fingerprint comparison; now judged by post-write hashes), and
`providerRouting` was schema-supported but unreadable from config. The
journey then hit a hard external wall: **OpenRouter credits exhausted**
(402 — $4.64 of $5.00 used; the remainder cannot afford Sonnet's measured
3.5k–7.3k-token proposals). **MVP-4F is `PASS`; Journey 6 remains `FAIL`,
blocked externally on credits.** Rerun Part 5 once after topping up the
key; no product work is pending.

MVP-4H removed the last product blocker: the comparator now surfaces its
always-computed overlap diff (coverage + overlap mismatch ratio, 0.5
comparable-area floor), dimension mismatch and content divergence are
separate truthful findings, deterministic content findings carry
root-frame attribution (`affectedFrame`, never a fabricated component),
and `prepare-visual-validation` adds a reference-aligned capture viewport
matching the real Figma export's pixel size. Seven new tests prove the
actionability distinction (real divergence → CORRECTION_ELIGIBLE;
instrumentation-only mismatch → no correction). Full regression 2,452
pass / 1 skip / 0 fail; commit `6ce904fd…`; fresh pack `3e29b396…`. The
final live Journey 6 rerun was then blocked externally: OpenRouter's
DeepSeek upstreams currently exceed the product's 120s model-timeout
ceiling (the same model ran in 26s earlier; a 300s override was correctly
rejected by profile schema validation). Four attempts, all pre-approval,
zero writes. **MVP-4H is `PASS`; Journey 6 remains `FAIL` — blocked
externally on DeepSeek serving latency**, needing only one clean rerun.

MVP-4G froze the corrected baseline (providerRouting audit: kept — it
completes a pre-existing schema/runtime/provider contract; new focused
tests; full regression 2,445 pass / 1 skip / 0 fail; commit `b8dc06f1…`)
and ran the final low-cost Journey 6 with `implementation-default`
overridden to `deepseek/deepseek-v4-flash-0731` (all other profiles
untouched; credit gate passed after the user raised the OpenRouter limit).
The final run produced an attempt-1-valid 8-file proposal at ~$0.001,
which was approved, snapshotted, applied exactly, validated, previewed,
captured, and honestly visual-failed. The correction offer — now past the
fixed fingerprint gate — truthfully reported no actionable finding: the
sole deterministic finding (viewport dimension mismatch) is not
component-bound, and the real content divergence yields no finding because
the dimension mismatch skips the pixel diff. **MVP-4G is `PASS`; Journey 6
remains `FAIL`**, with the deferred dimension-normalization comparator
debt now the single remaining prerequisite. DeepSeek is recommended as the
low-cost testing profile for `implementation-default`.

## MVP-4P — correction runtime preflight and resilient visual revalidation — 2026-08-08

MVP-4O's live correction applied successfully and passed mounted-project build validation, but the mounted page crashed at browser runtime because `NavigationMenu` was called without its required `items` prop. Its follow-up visual recapture also hit `ERR_MCP_TIMEOUT` while attempting an unnecessary fresh Figma Desktop reference fetch. MVP-4P closes those infrastructure and runtime-validity gaps without changing model profiles or the one-iteration policy.

- The exact correction proposal is validated in the existing bounded temporary workspace only: structural/hash/scope checks, required project build, then bounded localhost preview and browser runtime preflight.
- `pageerror`, unhandled browser exceptions, preview readiness/navigation failure, and missing capture are bounded diagnostics; console warnings are not blanket-fatal.
- Runtime failure feedback contains only attempt number, finite bound, typed code, and sanitized diagnostics. The Visual Correction Specialist owns repair.
- Maximum correction proposal attempts is 3; applied correction iterations retain the existing hard bound and canonical beta rule of one opt-in → one applied iteration (`1 of 1`).
- The preflight proposal hash is carried through proposal artifact, approval, snapshot, and apply checks. A changed proposal cannot reuse the old result.
- Each attempt cleans temporary workspace, preview, browser, and bounded ports in `finally`.

Post-correction Stage 5 reuses a persisted reference only when Figma file key, node/frame identity, screenshot artifact identity, and trusted provenance match. Dimensions alone never authorize reuse. If no valid reference exists, normal refresh remains the fallback. MCP timeout or post-apply capture failure becomes an honest inconclusive result; a successfully applied/project-validated correction is not falsely marked improved, and no iteration 2 starts.

Focused tests and the full Stage-6 boundary suite passed. Full forced validation: build 26/26, typecheck 44/44, lint 26/26, 52/52 Turbo test tasks; 2,509 passed, 1 skipped, 0 failed. Installed smoke and freshness verification passed. The disposable project was restored to commit `992d7d5`; independent validation covered 7 files and Vite build passed. The current inspector fingerprint is `97ce9bb0…`; prior `23c36efd…` remains historical evidence.

The current process had no `OPENROUTER_API_KEY`, so the final live Journey 6 rerun was not started. SIGINT acceptance remains unstarted. No secret, raw model response, auth header, or unrelated state was added. **MVP-4P: PASS for the implementation/regression gate. Journey 6: BLOCKED — credential not present.**

## MVP-4S — Coordinator output repair and final live gate — 2026-08-09

MVP-4S source is committed at `cd55af0`. Canonical and probe now share strict
Coordinator validation and the allowed-action check. Invalid output receives
bounded typed diagnostics and at most one fact-only repair attempt; no invalid
attempt can create a workflow. Valid decline and clarification remain final
decisions.

Focused tests were 129/129; agents were 238/238. Forced full regression was
build 26/26, typecheck 44/44, lint 26/26, and Turbo test 52/52 tasks (384 pass,
1 explicit live-provider skip, 0 fail). Smoke and freshness passed. Package
SHA256: `e1e1193bc2cdc485bedeccd95ecc09ce9065792b600bfdaa20d3479ed7ec5696`.

Live Coordinator-only gate trace `aabbc03a-6e8d-46d6-9a01-b99930408e1d`
passed on attempt 1 with `prepare_implementation`, frozen
`openai/gpt-4o-mini`, and workflow count `0`. The one canonical public
`--visual-correction=once` launch then exhausted the two Coordinator attempts
in trace `3646bbbe-4824-44b1-b2f6-26cc2ccf7f4b`: both attempts were provider
successes but schema-invalid `decline` responses with `reason` invalid/null.
The bounded terminal code was
`ERR_COORDINATOR_OUTPUT_ATTEMPTS_EXHAUSTED`; no workflow, approval, or write
was created. **MVP-4S implementation: PASS. Live Coordinator gate: PASS.
Journey 6: BLOCKED — COORDINATOR_OUTPUT_ATTEMPTS_EXHAUSTED.**

## MVP-4Q — final credentialed Journey 6 acceptance — 2026-08-09

Pure acceptance run on frozen `316fb01`; no source changes. Credential present and probed (200, GLM responded, no 401/402). Stale installed CLI repacked from the frozen HEAD (tarball `fec53db6…`). Parent `0cda5b14…`: compile gate rejected attempt 1 live (named PrimaryButton import), attempt 2 passed all gates including coverage and was manually approved with coverage summary plus bounded diff; apply and required validation passed; Stage 5 confirmed a major root finding (mismatch 0.9319) against a real Figma reference. Child `9c9efb82…`: one proposal, runtime preflight executed (`preflightProposalHash 034ec5e8…` bound pre-approval), manual approval, apply, mounted build passed. Revalidation stopped honestly inconclusive — the fresh Stage 5 threw pre-seed and the catch discarded the diagnostic (new reported defect); no product recapture, no crash, no iteration 2, no rollback. Supplementary non-product capture shows a fully rendered Spendly Add Expense screen with zero page errors. **MVP-4Q: PASS. Journey 6: FAIL — CORRECTION_APPLIED_RECAPTURE_INCONCLUSIVE.**

## MVP-4R — trusted reference handoff and diagnostics — 2026-08-09

The exact seam was `parent figma-source-snapshot → child parentArtifacts → seedStage5Inputs → readArtifact`. The parent snapshot was absent from the child list, so `ERR_MISSING_UPSTREAM_ARTIFACT` occurred before the first Stage-5 seed; the old catch dropped the cause. The schema was valid.

The correction input now carries an optional exact parent reference: logical artifact ID/type, content-addressed payload identity, parent image content hash, Figma file/node identity, and trusted provenance. The child performs exact store lookup and verifies all identities before recording `referenceSource: persisted`; valid reuse makes zero fresh Figma calls. Invalid/missing references use the existing fresh path. Bounded sanitized code/phase/message diagnostics are persisted, and applied/project-validated child results survive visual infrastructure failure honestly without false pass or iteration 2. Focused tests, full regression, smoke, and freshness passed. `OPENROUTER_API_KEY` remains missing, so final live Journey 6 was not run. **MVP-4R live gate: BLOCKED_EXTERNAL — OPENROUTER_CREDENTIAL_MISSING.**
## MVP-4R live acceptance completion attempt — 2026-08-09

Credential presence passed and one bounded GLM probe returned HTTP 200 in 5s.
Frozen source `cbb918c30a58768708b03f086e1ae513906dfaa6` was repacked and
installed as `designflow-ai@0.1.1`; installed binary SHA-256 is
`fccd466a55a9e39cd38150a63a91d8f8456e16fb80b68abcdf1625f91dc467e2` and the
bundle contains the MVP-4R trusted-reference markers. Settings proved both
implementation and visual-correction profiles remain OpenRouter
`z-ai/glm-5.2`, 8000 tokens, 120000 ms.

The clean fixture baseline was `992d7d518a2394862544547a9d28deff15ed14ed`
with inspector fingerprint `97ce9bb0e82b52d048de84ca533f79650aaa49d7ec56d848d260b863443a0e30`;
test and build passed. Figma Desktop and metadata readiness were healthy for
Spendly `1026:6098`, with the exact frame selected.

The canonical public launch `designflow run design-engineer
--visual-correction=once` was attempted once in a fresh acceptance home and
stopped before creating any workflow because the frozen coordinator returned
`The model's answer could not be used.` Persisted trace:
`c5c45f5a-45de-47e8-b5a1-fd3dbf40ba94`. There is no parent, child,
implementation/correction attempt, approval, apply, Stage 5 capture,
persisted-reference resolution, fresh-reference acquisition, Playwright
recapture, comparison, specialist result, or manual visual classification.
The fixture stayed clean; no source or model changes were made. Fresh-home
state is zero executions/parents/approvals, with no pending session; credential
and auth/provider-response scans are zero. **MVP-4R live gate:
BLOCKED_EXTERNAL — COORDINATOR_MODEL_OUTPUT_INVALID.**

### Coordinator diagnostic and bounded relaunch — 2026-08-09

The first trace had a successful OpenRouter coordinator call
(`openai/gpt-4o-mini`, profile `design-engineer-coordinator-default`, 629/37/666
tokens) followed by the frozen generic unusable-decision branch. The strict
schema, allowed actions, prompt, parser, structured-output configuration, and
retry behavior were inspected; no deterministic contract defect was found.
The raw model body was not persisted.

The single isolated coordinator-only probe did not invoke a workflow and
passed provider normalization, structured extraction, schema validation, and
allowed-action validation, returning `prepare_implementation` (572/42/614
tokens; 37.6s). Per the decision matrix this proved transient variance, so the
canonical public Journey 6 command was launched exactly once. It declined
again before workflow creation with trace
`a7f825a9-96fc-4f21-b116-fc4cef164230`; provider status was successful and usage
was 629/31/660 tokens. Fresh-home state remains executions `0`, parents `0`,
approvals `0`, events `0`. **Live classification: BLOCKED —
COORDINATOR_OUTPUT_RELIABILITY. No further Journey 6 launch is permitted.**
