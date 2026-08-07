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
