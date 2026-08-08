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
