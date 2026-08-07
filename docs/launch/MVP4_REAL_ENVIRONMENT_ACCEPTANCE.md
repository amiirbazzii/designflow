# MVP-4 Real Environment Acceptance

## 1. Audit summary

- Audit date: 2026-08-07
- Commit: `2c03812f729788992bc753318429cf829ddd5e58`
- Package: `designflow-ai`
- Version: `0.1.1`
- Branch: `main`

MVP-4A prepared the isolated acceptance environment and passed readiness.
MVP-4A.1 verified that canonical Design Engineer readiness remains available
without legacy Design Engineer experimental keys. MVP-4 Journey 2 was stopped
at the source-access boundary because the configured Figma MCP server had no
active design or FigJam tab. A retry on 2026-08-07 reached the same blocking
preflight error, so no workflow execution or live model call was completed.

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
| Live Figma specification | `FAIL_BLOCKING` | configured MCP server reported that the active tab is not a design or FigJam file; no real frame was available |
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
tokens were stored. No live OpenRouter request, DesignFlow workflow Figma
session, browser acceptance run, project write, approval, or rollback was
performed. A bounded local MCP discovery session was initialized only to
diagnose source availability and was closed successfully.

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
`84e182895c156098bf8a046ef5cbd7eaa8075423`. No live model request, DesignFlow
workflow run, browser run, consent, proposal, or project write was made.

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

MVP-4A.1 passes, but Journey 2 is blocked. Keep the flag-free config for
subsequent MVP-4 journeys. Activate a stable real design/FigJam tab and rerun
Journey 2 before beginning Journey 3. MVP-4 overall remains incomplete.

Journey 2 was stopped before workflow execution; Journeys 3–9 remain
unexercised.

MVP-5 was not started.

## 10. MVP-4 Journey 2 — live Figma specification

**Result: `FAIL_BLOCKING`**

The installed canonical command was started with the isolated home:

`DESIGNFLOW_HOME=/tmp/designflow-mvp4-acceptance-home designflow run design-engineer`

It reached the normal `Design file (homepage.fig)` prompt. No design file,
frame, project consent, implementation input, or workflow ID was supplied. The
prompt was aborted before execution, so there is no run ID, no model request,
no project write, and no DesignFlow execution state to inspect.

A bounded local MCP handshake confirmed the configured endpoint is the real
Figma Dev Mode MCP Server (`1.0.0`) and accepted protocol version
`2025-03-26`. The subsequent `tools/list` request returned the safe server
error: `The MCP server is only available if your active tab is a design or
FigJam file.` No Figma node, frame, or file evidence was retrieved. The MCP
discovery session was closed with HTTP 200.

The disposable project remained clean at
`84e182895c156098bf8a046ef5cbd7eaa8075423`; isolated history remained empty.
Because no real Figma frame was accessible, coordinator routing, live
OpenRouter invocation, Figma Specification Specialist invocation, artifact
production, and provenance acceptance could not be exercised. Journey 3 must
not begin until a real design/FigJam tab is active and the source-access check
passes.

## 11. MVP-4 Journey 2 retry

The requested rerun performed the bounded MCP preflight before starting the
CLI. Initialize again accepted protocol `2025-03-26` and identified Figma Dev
Mode MCP Server `1.0.0`, but `tools/list` again returned:

`The MCP server is only available if your active tab is a design or FigJam file.`

The diagnostic session was closed with HTTP 200. Per the acceptance rules, the
canonical `designflow run design-engineer` command was not started. The project
remains clean at the recorded baseline and isolated history remains empty.

## 12. MVP-4 Journey 2 URL retry

The provided Spendly URL and node `1026:6098` passed the bounded MCP preflight.
The server exposed six tools, including `get_design_context` and
`get_metadata`. Read-only retrieval succeeded for node `1026:6098`, named
`iPhone 16 Pro Max - 14`, with dimensions `440×1092` and child frames including
`Back Button` and `Frame 1`. The diagnostic session closed with HTTP 200.

The canonical command was then run with the provided URL, React, and node
`1026-6098`. The only approval was for storing a DesignFlow artifact; it
explicitly did not change the project. The run completed with ID
`2d457c60-8b54-4a00-a851-f5620b8953cc`, but acceptance is **FAIL_BLOCKING**:

- history labels the run generic `Design → Code`, not a specification journey;
- the persisted trace `239425ee-cb64-4e92-b5fc-45b8c1fab3dc` records
  `Model calls: 0`;
- no live Design Engineer Coordinator model call occurred;
- no OpenRouter provenance was recorded;
- no Figma Specification Specialist invocation occurred;
- the stored design-analysis artifact contains only the URL and node component
  identity, not normalized live Figma evidence.

The run created five generic artifacts and completed without project writes.
The project remains clean at `84e182895c156098bf8a046ef5cbd7eaa8075423`.
Because the live coordinator and specification specialist requirements failed,
Journey 3 must not begin. No product fix was attempted.

## 13. MVP-4B — canonical Design Engineer specification dispatch remediation

**Defect classification: `MVP-4 BLOCKING PRODUCT DEFECT`**

The URL retry established that the public `designflow run design-engineer`
command could present the historical generic Design → Code form and run the
compatibility workflow instead of the accepted product journey. The initially
used globally installed executable also predated the current source build. Its
composition root still gated Figma workflow registration on legacy experimental
keys, so the flag-free acceptance home exposed the generic fallback. In the
current source, the Design Engineer worker manifest also placed the generic
workflow first, causing shared manifest consumers to select its form as the
primary surface.

MVP-4B corrects the public dispatch boundary without changing the generic
workflow's internal/historical availability:

- the Design Engineer worker now exposes the Figma specification workflow as
  its canonical primary workflow and a product-oriented request/Figma-source
  form;
- the generic `design-to-code` workflow remains a historical compatibility
  alias but is rejected through public `run` resolution;
- workflow registration facts used by canonical dispatch now feed the shared
  readiness projection, so Specification `READY` and Implementation
  `READY_TO_REQUEST_CONSENT` cannot be reported when their canonical dispatch
  paths are absent;
- legacy API/demo compatibility surfaces retain their native generic form
  rather than inheriting the Design Engineer product form.

Focused routing, readiness, compatibility, approval-boundary, Figma
availability, cancellation, and artifact-presentation tests passed. Forced
package validation also passed: smoke, freshness, build (26/26), typecheck
(44/44), lint (26/26), and all 26 forced test tasks, with remote cache disabled.

The required live Journey 2 rerun has not been started from this source state:
the current execution environment does not contain a non-empty
`OPENROUTER_API_KEY`. A model-backed rerun would therefore be dishonest and
cannot satisfy the live-coordinator criterion. The initial Journey 2 result
remains `FAIL_BLOCKING` until a fresh installed package is run with the
credential available; Journey 3 remains prohibited.

## 14. MVP-4B.1 — regression reconciliation

The prior MVP-4B test claim was incomplete. `designflow-ai#test` failed because
`doctor.test.ts` changed Figma configuration after `createCliContext` had
already registered workflows. The fixture now writes configuration before
composition, matching real startup. TTY reproduction also found direct
`designflow run` could offer the menu-only artifact viewer; that viewer is now
an explicit interactive-menu option while direct runs retain correction consent.

Final forced validation: build 26/26, typecheck 44/44, lint 26/26, and tests
52/52 Turbo tasks (2,414 pass, 1 skip, 0 fail; exit 0), all cache-bypassed.
Installed smoke and freshness passed. Smoke rebuilt and isolatedly installed a
fresh `designflow-ai@0.1.1` tarball. The active process still lacks a non-empty
`OPENROUTER_API_KEY`; Journey 2 was not rerun and Journey 3 remains prohibited.
