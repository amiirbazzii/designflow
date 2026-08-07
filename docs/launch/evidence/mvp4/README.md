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
