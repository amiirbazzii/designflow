# MVP-4 real-environment evidence

Audit date: 2026-08-07

This directory contains redacted MVP-4 acceptance evidence. MVP-4A prepared a
fresh isolated DesignFlow home and a clean disposable Git/frontend fixture.
MVP-4A.1 verified flag-free flagship readiness: the two legacy Design Engineer
experimental keys are absent, while the valid Figma MCP configuration still
provides canonical specification and implementation readiness. Readiness passes
with the expected warning that doctor does not start a Figma protocol session.

No live OpenRouter request, Figma MCP session, browser acceptance journey, or
project write was started. Journeys 2–9 remain unexercised.

The acceptance home remains at `/tmp/designflow-mvp4-acceptance-home` and is
kept for the next authorized journey. Its config has no legacy
`settings.experimental.designEngineerFigmaMcp` or
`settings.experimental.designEngineerImplementation` key. No secret-bearing
configuration was copied or stored.

Secrets, environment dumps, raw provider responses, and private screenshots
must not be stored here.
