# MVP-4 Real Environment Acceptance

## 1. Audit summary

- Audit date: 2026-08-07
- Commit: `ae1e6909e86f04f3debc9d751d76d5a103b325f9`
- Package: `designflow-ai`
- Version: `0.1.1`
- Branch: `main`

MVP-4A prepared the isolated acceptance environment and passed readiness.
MVP-4A.1 verified that canonical Design Engineer readiness remains available
without legacy Design Engineer experimental keys. No MVP-4 live journey was
claimed or started.

## 2. Environment summary

- Installed CLI: `DesignFlow 0.1.1`
- OpenRouter credential presence: configured; value was not inspected
- Configured Figma transport: localhost HTTP MCP endpoint; protocol discovery
  was not started because doctor is read-only
- Playwright: available
- Chromium: available
- DesignFlow home: `/tmp/designflow-mvp4-acceptance-home`
- Fixture: `/tmp/designflow-mvp4-acceptance-project`
- Fixture stack: React 18.3.1 + Vite 6.0.0, npm
- Fixture baseline: `84e182895c156098bf8a046ef5cbd7eaa8075423`
- Fixture install: `npm install --ignore-scripts` passed; 62 packages
  installed outside the DesignFlow repository

## 3. Readiness result

**PASS** for MVP-4A.1 flag-free flagship readiness.

The isolated home contains exactly one clean registered project. `doctor`
reports the project and browser healthy, OpenRouter credential presence safely,
and the configured Figma HTTP transport. Its expected Figma warning states that
doctor does not start protocol sessions.

The acceptance config is now flag-free for legacy Design Engineer settings.
The valid `settings.figmaMcp` block is sufficient for Figma and implementation
workflow registration. The public Design Engineer worker remains registered,
specification remains `READY`, implementation remains
`READY_TO_REQUEST_CONSENT`, and correction remains `BETA_NOT_STARTED`.

The fixture is a clean Git repository on `main`, with a known baseline commit,
React/Vite structure, reusable components, CSS tokens, and deterministic
build/test/preview commands.

Journey readiness is classified as specification `READY`, implementation
`READY_TO_REQUEST_CONSENT`, and visual correction `BETA_NOT_STARTED`. No
implementation consent was requested or granted.

Evidence: `docs/launch/evidence/mvp4/readiness.txt`.

## 4. Journey results

| Journey | Result | Reason |
| --- | --- | --- |
| Live readiness | `PASS` | isolated home and clean disposable fixture are ready; Figma protocol session intentionally not started |
| Live Figma specification | `NOT_EXERCISED_NOT_NEEDED` | readiness blocker occurred first |
| Proposal rejection | `NOT_EXERCISED_NOT_NEEDED` | no safe real project available |
| Approved implementation | `NOT_EXERCISED_NOT_NEEDED` | no safe real project available |
| Independent validation | `NOT_EXERCISED_NOT_NEEDED` | implementation was not started |
| Real visual validation | `NOT_EXERCISED_NOT_NEEDED` | implementation was not started |
| Beta correction | `NOT_EXERCISED_NOT_NEEDED` | no eligible real implementation baseline |
| Rollback | `NOT_EXERCISED_NOT_NEEDED` | no safe live write was attempted |
| Live SIGINT cancellation | `NOT_EXERCISED_NOT_NEEDED` | no live journey was started |
| Artifact/trace audit | `NOT_EXERCISED_NOT_NEEDED` | no live run exists yet |

## 5. Security and privacy

No credentials, environment dumps, raw provider responses, screenshots, or
tokens were stored. No live OpenRouter request, Figma MCP session, browser
acceptance run, project write, approval, or rollback was performed.

The fixture install reported two npm audit findings (one moderate, one high).
No audit fix was applied; the findings are isolated to the disposable
acceptance fixture and do not modify DesignFlow dependencies or lockfiles.

## 6. MVP-4A.1 flag-free verification

### Legacy keys found

The isolated config initially contained these names under
`settings.experimental`:

- `designEngineerFigmaMcp`
- `designEngineerImplementation`

They were removed after creating the external backup
`/tmp/designflow-mvp4-acceptance-home/config.mvp4a1.backup.json`.
The resulting config retains `settings.figmaMcp`; `settings.experimental` has
no Design Engineer keys.

### Source locations and classification

- `apps/designflow-cli/src/services/figma-mcp-config.ts:79-90` contains the
  compatibility readers for both names.
- `apps/designflow-cli/src/services/cli-runner.ts:572-581` invokes those
  readers only for compatibility and derives availability from the parsed
  `settings.figmaMcp` result.
- `apps/designflow-cli/src/services/cli-runner.ts:166-203` registers the
  specification, implementation, visual-validation, and correction workflows
  from the parsed Figma configuration, not from the legacy keys.
- `apps/designflow-cli/src/services/cli-runner.ts:1023-1024` exposes the
  resulting implementation/Figma context to the CLI.
- `apps/designflow-cli/src/commands/interactive.ts:53` consumes that derived
  implementation availability to request project selection; it does not read
  either legacy key.
- `apps/designflow-cli/src/services/doctor.ts` reads the parsed Figma block and
  does not require either legacy key.

Both keys are classified as **compatibility-only** in the canonical runtime.
They do not affect worker registration, Figma availability, implementation
availability, correction-loop registration, doctor readiness, or canonical
routing. Test fixtures and historical documentation still mention them for
backward-compatibility coverage; those references do not make them required by
the flagship journey.

### Serial verification

With both keys absent, these commands were run serially with
`DESIGNFLOW_HOME=/tmp/designflow-mvp4-acceptance-home`:

1. `designflow workers` — PASS; Design Engineer remains registered.
2. `designflow doctor` — PASS_WITH_WARNING; configuration, model-provider,
   project, and browser checks are healthy; the expected Figma warning says
   doctor does not start protocol sessions.
3. `designflow settings` — PASS; normal assignments and safe credential
   presence are shown, with no hidden-key guidance or credential value.
4. `designflow projects` — PASS; only `mvp4-acceptance` is listed.
5. `designflow workers design-engineer` — PASS; the public Design Engineer
   surface remains available with its OpenRouter assignment.

The project remained clean at baseline commit
`84e182895c156098bf8a046ef5cbd7eaa8075423`. No live model request, Figma
protocol session, browser run, consent, proposal, or project write was made.

## 7. Defects and fixes

No product defect was found or fixed. The legacy keys were unnecessary
acceptance-environment baggage, and the existing product wiring is already
flag-independent. Product code and `.claude-flow/` state were not modified.

## 8. Regression evidence

The current commit previously passed:

- build: 26/26
- typecheck: 44/44
- lint: 26/26
- tests: 2,413 passed / 1 skipped / 0 failed
- installed smoke: PASS
- package freshness verifier: PASS

Focused recheck at this commit passed 13 tests plus the CLI vocabulary
regression test. Full regression was not rerun after this documentation-only
evidence addition.

## 9. Recommendation

MVP-4A.1 passes. Keep the flag-free config for subsequent MVP-4 journeys. The
environment is ready for the next explicitly authorized step: Journey 2, live
Figma specification. MVP-4 overall remains incomplete until Journeys 2–9 are
exercised and evidenced.

Journeys 2–9 remain unexercised.

MVP-5 was not started.
