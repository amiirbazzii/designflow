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

## 15. MVP-4 Journey 2 — live rerun with credential present

**Result: `FAIL_BLOCKING`**

`OPENROUTER_API_KEY` was confirmed non-empty (value not inspected). The stale
globally installed CLI (built 2026-08-05, predating source HEAD) was rebuilt:
`npm run build` (26/26 cached full turbo), `apps/designflow-cli` rebuilt with
`bun build` and `scripts/prepare-cli-package.sh` (force rebuild, 25/25 tasks),
packed with `npm pack`, and reinstalled with `npm install -g
/tmp/designflow-ai-0.1.1.tgz --prefix /Users/wallex/.local`. Resolved
executable: `/Users/wallex/.local/bin/designflow` → real path
`/Users/wallex/.local/lib/node_modules/designflow-ai/dist/main.js`
(reinstalled 2026-08-07 16:02, superseding the stale copy). `designflow
--version` reports `DesignFlow 0.1.1`.

The disposable project fixture was verified clean at baseline
`84e182895c156098bf8a046ef5cbd7eaa8075423` before the run (empty diff, no
untracked changes).

A bounded local MCP handshake against `http://127.0.0.1:3845/mcp` confirmed
`Figma Dev Mode MCP Server` `1.0.0`, protocol `2025-03-26`; `tools/list`
returned six tools including `get_metadata` and `get_design_context`; a
`get_metadata` call for node `1026:6098` returned the real nested Spendly
hierarchy (`Back Button`, `Tab`, `Add Expense Form` with six text fields and a
submit button, `Expense History` with five list items, `Navigation menu v3`).

The isolated home's `config.json` was populated with a `settings.figmaMcp`
HTTP block pointing at the live local server (`captureScreenshots: true`);
`designflow doctor` reported configuration valid, model-provider credential
present, Figma configured, and Design Engineer specification readiness
`ready`.

`designflow run design-engineer` was run non-interactively with the
specification-only request text and the Spendly URL
(`https://www.figma.com/design/E958ARSSBoJjblLhxZQVSU/Spendly?node-id=1026-6098`),
no frames, no project registered, no implementation consent, no workflow ID,
and no experimental flags. Dispatch went through the canonical product path —
"Design Engineer" → "Design → Code (Figma Specification)" — not the generic
`design-to-code` compatibility form; no generic Framework/Node prompt and no
five-artifact scaffold appeared. Run id `2db9a81c-6034-4751-9ce0-274cbff69b42`
completed in 39s with 4 created artifacts (0 reused): Parsed Figma source,
Figma source snapshot, Design specification, Stage 3 summary. No project
files were written; no consent was requested or granted.

Trace inspection (`designflow traces`) confirms two independent live
OpenRouter calls, both `success`:

- Design Engineer Coordinator: `OpenRouter openai/gpt-4o-mini`, profile
  `design-engineer-coordinator-default`, 615 total tokens, cost 0.00011115.
- Figma Specification Specialist: `OpenRouter openai/gpt-4o-mini`, profile
  `figma-specification-default`, 1347 total tokens, cost 0.0002889 (agent
  version `0.2.0`).

Each stage used its own configured profile; no deterministic fallback was
used despite the credential being present.

**Defect — normalized Figma evidence collapses to identity-only.** The
`figma-source-snapshot` artifact's single `nodes[0]` entry for
`1026:6098` has empty `childIds`, `fills`, `strokes`, `effects`, and
`properties`; `variables`, `styles`, `components`, and `assets` are all empty
arrays; `capabilities.componentsAvailable` and `capabilities.stylesAvailable`
are `false`. Two warnings are recorded: `DESKTOP_MCP_SELECTION_SCOPE` ("The
official Desktop MCP server supplied the current selection, not a full file
document") and `VARIABLES_SHAPE_UNRECOGNIZED` ("Desktop MCP returned variable
definitions in a non-normalized text format"). The downstream
`design-specification` artifact mirrors this: `hierarchy` contains only the
single root node's `id`/`name`, and every other field —
`designTokens.colors/spacing/typography/radii/borders/shadows`, `components`,
`layoutBehavior`, `content`, `interactions`, `states` — is an empty array or
list. `frames` is empty even though `resolvedFrames` in the snapshot names
the frame.

This is not a source-access limitation: a manual `get_design_context` call
against the same live MCP session for the same node, made during this
acceptance run, returned substantial real design detail — generated
React/JSX with per-node `data-node-id` attributes, CSS custom properties for
colors and spacing (e.g. `--stroke/neutral/stroke,rgba(0,0,0,0.02)`), and
named child components (`NavigationMenuV`, `lucide/circle-plus`) — none of
which reached the persisted specification. The deterministic parsing/mapping
step between the MCP tool response and the normalized snapshot fails to
extract hierarchy, fills, or tokens from the real response shape, so the
persisted evidence is effectively URL/node identity only, contrary to
requirement 7 ("If it again stores only URL/node identity, fail Journey 2").
Per requirement 9, a specification this generic does not clearly describe the
Spendly frame and is independently `FAIL_BLOCKING`.

No-write proof after the run: `git rev-parse HEAD` still
`84e182895c156098bf8a046ef5cbd7eaa8075423`, `git status --short` empty, `git
diff --stat` empty, no untracked implementation output. `designflow history`
shows one `failed` run (`4e298c28…`, input-validation failure from a first
attempt where the URL was mistakenly entered in the wrong prompt field) and
one `completed` run (`2db9a81c…`); no stale running execution and no pending
approval. No credentials, raw prompts, or provider responses were captured in
this record — only role, profile ID, model ID, provider display name
(`OpenRouter`), status, and token/cost usage fields.

**Journey 2 classification: `FAIL_BLOCKING`.** Fresh CLI, live Figma access,
canonical dispatch, live coordinator, live specification specialist, typed
artifact production, and the no-write guarantee all passed. The run fails on
requirements 7 and 9: the workflow's normalized Figma evidence does not carry
real design facts beyond URL/node identity into the persisted specification,
even though the underlying MCP source clearly has that detail available.
Journey 3 must not begin. The defect is in the deterministic Figma
source-parsing/normalization step (between MCP tool response and
`figma-source-snapshot`/`design-specification`), not in credential handling,
dispatch routing, or model connectivity.

## 16. MVP-4C — real Figma MCP response normalization fix

**Journey 2 result after fix: `PASS`**

### Exact root cause

The Desktop adapter (`packages/capabilities/figma-mcp/src/figma-desktop-adapter.ts`)
made the right MCP calls but destroyed their evidence deterministically:

1. `get_metadata` returns the full selected subtree as an XML-like outline in
   a text content block (`<frame id … x y width height>` nested tags, with
   `hidden="true"` for invisible nodes). The adapter's `parseDesktopSelection`
   extracted only the selection line's id/name (plus a tag-name type probe)
   and passed a bare `{ id, name, type }` literal to `normalizeFigmaNodeTree`
   — the entire outline tree, geometry, and child structure were discarded at
   that call site.
2. `get_design_context` returns six text blocks; the first is generated
   React+Tailwind code carrying one `data-node-id` per element plus utility
   tokens emitted from real node properties (colors, radii, gaps, font
   family/style/size) and the nodes' visible text. The adapter awaited the
   call **and dropped the result** — the success path bound nothing.
3. `get_variable_defs` returns one JSON object of name → value in a text
   block (e.g. `{"Font":"Poppins","Stroke/Neutral/stroke":"#00000005"}`).
   The adapter treated any non-empty text as unrecognized and always emitted
   `VARIABLES_SHAPE_UNRECOGNIZED` with an empty variables list.

Fixture tests never caught this because they asserted exactly the sparse
behavior: the metadata fixture was a single unclosed tag with no children and
the assertions accepted a single-node snapshot with empty collections.

### Fix

- New `parse-desktop-metadata.ts`: parses the outline grammar (tags,
  attributes, self-closing forms, `hidden`) into a nested raw tree fed to the
  existing `normalizeFigmaNodeTree` — hierarchy, parent/child links, node
  types, and per-node geometry survive.
- New `parse-desktop-design-context.ts`: extracts per-`data-node-id` facts
  from the generated code using only its closed token forms — visible text
  (including template-literal wrapping; text belonging to nested elements is
  not attributed to the container), solid background/text/border colors,
  corner radius, gap, flex direction, opacity, and font family/style/size.
  Nothing is evaluated; unrecognized tokens are ignored, not guessed.
- Adapter merge semantics: the metadata outline is the structural source of
  truth; design-context facts only fill fields the outline could not provide
  and never overwrite non-empty values with empty ones. Variables are parsed
  from the real JSON-in-text shape (hex values typed `COLOR`); non-JSON
  payloads still produce `VARIABLES_SHAPE_UNRECOGNIZED` honestly. `INSTANCE`
  nodes are recorded as real component references and
  `capabilities.componentsAvailable` reflects them.
- Loss detection: a snapshot whose only content is node identity (no
  structure, geometry, text, or fills) now fails the workflow with
  `ERR_FIGMA_EVIDENCE_INSUFFICIENT` instead of producing a misleading
  "valid" empty specification. A failed design-context retrieval records its
  classified error code in the warning. The typed
  `figma-source-snapshot` contract is unchanged — no schema migration.

### Secondary environment finding

With the parser fixed, two live reruns still lost design context to
`ERR_MCP_TIMEOUT`: cold `get_design_context` generation for this frame
exceeds the configured 30s/120s request timeout (a warm call completes in
~15s). The acceptance home's `settings.figmaMcp.requestTimeoutMs` was raised
to 300000; no product code change was needed for this.

### Validation

Focused: `@designflow/capability-figma-mcp` 78/78; agents integration test
proves a Desktop-shaped rich snapshot yields real hierarchy, text, and style
facts in the deterministic specification path. Full forced regression on the
final source: build 26/26, typecheck 44/44, lint 26/26, test 52/52 Turbo
tasks (2,430 pass, 1 skip, 0 fail, exit 0), smoke PASS, freshness PASS. The
corrected package (`npm pack` shasum `21e9bd793a0cb8700395e9615e724dccdb601443`)
was reinstalled to `/Users/wallex/.local`; `designflow --version` reports
`DesignFlow 0.1.1` from the reinstalled `dist/main.js`.

### Live Journey 2 rerun (run `7578ff95-17f8-4009-aaa0-f9e56d4f5743`)

Same canonical command, request, and Spendly source; no consent, workflow ID,
or flags. Completed in 55s with 4 created artifacts. Corrected snapshot for
node `1026:6098`:

- 40 normalized nodes; root children `1026:6099`, `1026:6104`, `1026:6137`;
  geometry on all 40;
- 7 text nodes: "Add Transaction", "Expense", "Income", "Add New Expense",
  "Fill in the details below to track your expense", "May 2024",
  "Expense History";
- 14 nodes with solid fills; radii (Text field 10, Button 12, container 16);
  27 nodes with layout direction; real gaps (8/2/15/4); 7 nodes with
  Poppins typography facts;
- 16 component references (Button ×4, Text field ×6, Expense History Item
  ×5, Navigation menu v3); 5 variables (Font, spacingNone, two stroke
  colors typed `COLOR`, bgBlur2);
- warnings: only the expected `DESKTOP_MCP_SELECTION_SCOPE`.

Coordinator: live OpenRouter `openai/gpt-4o-mini`, profile
`design-engineer-coordinator-default`, success, 612 tokens,
`create_specification`. Specialist: live OpenRouter `openai/gpt-4o-mini`,
profile `figma-specification-default`, success, **5,783 tokens (5,306 in)**
— versus 1,347 before the fix, direct evidence the specialist consumed the
rich normalized snapshot. The typed specification now names the real
components with sensible roles (Button, Text field → "Input Field", Expense
History Item → "List Item", Navigation menu v3 → "Navigation"), carries the
real palette (white, #ececec, #f9f9f9, #e4e4e4, #707070, #0000001a,
#00000005), Poppins typography, and all five real variable names. Remaining
minor gaps (model-side summarization, not retrieval loss): the spec's
`content` list and deep hierarchy entries are thinner than the snapshot
evidence.

No-write proof after the rerun: fixture HEAD still
`84e182895c156098bf8a046ef5cbd7eaa8075423`, clean tree, empty diff, no
untracked output, no consent/apply/rollback. History shows the completed run
with no stale execution or pending approval; traces record only role,
profile, model, provider (`OpenRouter`), status, and usage — no credentials,
prompts, or raw provider responses.

**Journey 2 is reclassified `PASS`.** Journey 3 remains unstarted and
requires separate authorization.

## 17. MVP-4 Journey 3 — live implementation proposal rejection

**Result: `PASS`** (run `1642b74a-a0ae-48b4-9cda-c5caef5165b5`,
commit `837fa9c6725b9d0c6817d74af29e0ae5edbee796`)

Preconditions held: credential present, Figma MCP live, fresh MVP-4B/4C CLI
resolved. The fixture was verified clean at
`84e182895c156098bf8a046ef5cbd7eaa8075423` with passing `npm test` /
`npm run build` before the run, and an independent content fingerprint
(`c2ad656d…`) was recorded.

The canonical command ran with explicit implementation intent against the
registered `mvp4-acceptance` project. Journey consent ("Prepare changes for
this project?") was answered yes — preparation only. The live coordinator
(OpenRouter `openai/gpt-4o-mini`, `design-engineer-coordinator-default`)
routed to the 23-step implementation workflow; the corrected rich Figma
evidence was retrieved in-workflow; deterministic project inspection found
react 18.3.1/npm/`src`/CSS tokens; deterministic mapping recorded honest
token/component decisions; the live Implementation Specialist
(`implementation-default`, OpenRouter, 1,955 tokens) produced a typed
proposal: modify `src/components/Button.js`, create `TextField.js`,
`ExpenseHistoryItem.js`, `NavigationMenu.js` — all inside the fixture, no
deletes, no package changes.

The exact-approval prompt was presented separately, bound via
`implementation-approval` to proposal hash `75ba4ae1…` and project
fingerprint `8ba11902…`. It was answered **reject**: the workflow stopped,
artifacts remain inspectable, and the summary truthfully stated nothing was
written. Post-rejection: HEAD, status, diff, and the independent
fingerprint all unchanged; `npm test`/`npm run build` still pass; no apply,
rollback, preview, or correction artifacts exist; no pending approval or
running execution remains; no credential material in stored state.

Non-blocking discrepancies recorded: project inspection missed the
fixture's `.jsx` reusable components (so the proposal's Button "modify"
targets a non-existent `Button.js` and reuse was limited), and history
labels the rejected run `failed · did not finish` rather than a distinct
rejected outcome. Neither is unsafe; both are quality follow-ups.

Journey 4 was not started; no proposal was approved and no changes were
applied. Journey 4 may begin when separately authorized.

## 18. MVP-4D — project inspection and proposal path integrity

**Result: `PASS`** (commit under review; final valid-proposal run
`ca9cdfed-3499-4618-ac22-0228a326be1c`)

Evidence correction: §17's "empty component inventory" claim was an
evidence-reading error in the acceptance tooling — the Journey 3
`project-implementation-context` artifact already listed `FeatureCard` and
`PrimaryButton` under `designSystem.components`, the inspector's filter has
always accepted `.js/.jsx/.ts/.tsx`, and the mapper's "Button → 0.6
manual-review" was a real below-threshold match against `PrimaryButton`.
Pinning regression tests for `.jsx`/`.js`/`.tsx` discovery and mapper
visibility were added regardless.

Real defect fixed: the deterministic proposal step stored and presented
model output without host validation. `validateProposedFileChanges` gained
existence semantics (`ERR_PROPOSAL_TARGET_MISSING` /
`ERR_PROPOSAL_TARGET_EXISTS`, checked before the base-hash rule), the
`store-proposed-file-changes` capability now stamps deterministic
`expectedBaseHash` values and validates before the approval prompt, and
apply-time revalidation is resume-tolerant without weakening approval
hashes or fingerprints. One instruction line was added to the
Implementation Agent (modify only listed paths; new files are creates).

Validation: focused suites 30/94/229 all green; full forced regression
build 26/26, typecheck 44/44, lint 26/26, tests 52/52 tasks (2,434 pass,
1 skip, 0 fail); smoke and freshness PASS; fresh package shasum
`945fa2c2…` installed. Live rechecks: two invalid model proposals (phantom
and absolute `Button.js` modifies) were deterministically stopped before
the approval prompt with zero writes; the third run produced a valid
creates-only proposal (TextField, ExpenseHistoryItem, NavigationMenu —
all vacant fixture paths, hash/fingerprint-bound) that was rejected at the
exact-approval prompt. Fixture HEAD, tree, independent fingerprint, and
build/test all unchanged after every run. Journey 4 remains unstarted.

## 19. MVP-4 Journey 4 — live approved application + validation + visual acceptance

**Result: `PASS`** (run `fb0366d5-b6d1-49ba-9104-9b2b48897608`,
baseline commit `e65777e159e6502a1217665872efe98d47908677`, fresh package
shasum `945fa2c2…`)

The first intentionally-authorized write journey completed end to end:
live coordinator routed to implementation; the workflow retrieved rich
Figma evidence and the specification specialist ran live; deterministic
inspection saw both `.jsx` components and CSS tokens; mapping recorded
honest decisions (Button → 0.6 manual-review); the live Implementation
Specialist produced a 4-create proposal (`TextField.js`,
`ExpenseHistoryItem.js`, `NavigationMenu.js`, `src/styles/tokens.css`)
that passed the MVP-4D deterministic validation gate before the approval
prompt. Exact approval (bound to proposal hash `f2cd8a13…` and fingerprint
`8ba11902…`, distinct from journey consent) was granted; snapshot
`976e9076…` was taken before mutation covering exactly the 4 paths; apply
created exactly the approved files and nothing else; deterministic
validation ran the project's own build/test (both passed, others
truthfully `unavailable`); independent `npm test`/`npm run build` passed.
The preview (`npm run preview` on 127.0.0.1:51324) served the real
fixture; Playwright captured 3 real viewports; the deterministic
`png-rgba-pixel-diff-v1` comparison against the real Figma reference
(413×1024, `real-figma` authenticity) reported mobile **fail**
(dimension mismatch 390×844) and desktop/tablet truthfully
`inconclusive`; the live Visual Validation Specialist
(`visual-validation-default`) confirmed and the typed report records
status fail, 1 major finding.

Manual assessment found the deeper actionable gap: the created components
were never mounted in `App.jsx`, so the page still renders the original
fixture app — an implementation-quality issue that DesignFlow itself
truthfully flagged as a visual fail (no false clean pass, which is the
blocking condition). The run is `CORRECTION_ELIGIBLE`; no correction was
started, and the implemented state is preserved. No orphan processes, no
secret leakage, no unauthorized paths; history shows a completed run with
no pending approvals. Deferred UX debt unchanged (rejected-run history
label; sparse specialist trace rows — the implementation/visual
specialist rows again omit Role/Run-id display fields). New measurement
debt recorded: with mismatched dimensions the pixel diff is skipped, so
deterministic metrics alone would not catch content-level divergence.

## 20. MVP-4 Journey 6 — bounded live visual correction

**Result: `FAIL` — correction loop unreachable; all safety gates held.**

Two product defects were exposed and analyzed (full detail in
`evidence/mvp4/correction-run.md`):

1. **Correction offer silently no-oped.** `readImplementationInput`
   strict-parsed the session's superset input, so
   `--visual-correction=once` returned before the offer even after a
   completed implementation with a failing visual verdict (run
   `74d74e75-…`). Fixed in
   `apps/designflow-cli/src/services/visual-correction.ts` (filter to the
   workflow schema's own keys). Full forced regression after the fix:
   build 26/26, typecheck 44/44, lint 26/26, tests 52/52 tasks (2,434
   pass, 1 skip, 0 fail), smoke PASS, freshness PASS; fresh package
   `ed1209d7…` installed.
2. **Implementation Specialist proposal validity on non-empty projects.**
   Across five live attempts, the pinned `openai/gpt-4o-mini` specialist
   produced four operation-invalid proposals (a phantom
   `modify Button.jsx`, and three `create TextField.js` collisions with
   existing files) — every one deterministically blocked BEFORE the
   approval prompt by the MVP-4D gate with zero project writes and
   accurate typed diagnostics. A strengthened agent instruction did not
   change the behavior; model profiles were out of scope. Retries were
   stopped rather than mined for a convenient pass.

Positive acceptance evidence retained: explicit-only authorization
(default-off proven by Journey 4's flag-less run), host-derived
correction eligibility from persisted state, five live demonstrations of
the pre-approval validation gate, byte-identical fixture fingerprints
after every blocked attempt, clean process/no-leak checks. The correction
child, Visual Correction Specialist, correction approval/snapshot/apply,
and one-iteration runtime bound remain unexercised. The fixture retains
the Journey 4 files plus one additional approved set of three `.jsx`
components (final fingerprint `e6b053b2…`; build/test green); the Journey
4 major finding stands and the run remains correction-eligible.

Journey 6 must be rerun after the proposal-validity defect is addressed
(stronger implementation profile, a bounded regenerate-on-invalid loop,
or an explicitly contracted host-side create→modify reconciliation).

## 21. MVP-4E — bounded correction proposal regeneration

**MVP-4E result: `PASS`. Journey 6 final:
`FAIL — CORRECTION_PROPOSAL_ATTEMPTS_EXHAUSTED`.**

The regenerate-on-invalid loop was implemented at the verified proposal
owner (the Implementation Agent's invoke stage — the correction child's
own Visual Correction Agent is already scope/hash-bound and cannot emit
this failure class): at most 3 attempts per iteration, MVP-4D validation
after each, typed fact-only repair feedback between attempts, a strict
repairable-code allow-list, cancellation-aware, typed
`ERR_PROPOSAL_ATTEMPTS_EXHAUSTED` on exhaustion, attempt provenance on
the output artifact, and approval bound only to a final valid proposal.
Five focused tests cover invalid→valid, double-invalid→valid,
exhaustion-with-no-fourth-call, cancellation, and non-repairable
termination. Full forced regression: build 26/26, typecheck 44/44, lint
26/26, tests 52/52 tasks (2,439 pass, 1 skip, 0 fail); smoke and
freshness PASS; fresh package `56b25932…` installed.

The single authorized live rerun (`6fad96d3-…`) exercised the mechanism
end to end: three live `implementation-default` OpenRouter calls with
repair feedback demonstrably delivered (input tokens 1,643→1,771→1,800),
all three proposals still invalid, honest pre-approval termination with
zero writes, fixture byte-identical (`e6b053b2…`), no pending state, no
orphans, no leaks. The pinned `openai/gpt-4o-mini` profile is the
remaining obstacle (6 invalid proposals across 8 lifetime attempts on
this fixture); model-profile changes were explicitly out of scope. The
correction-stage machinery itself remains unexercised and Journey 6
stays failed until a stronger profile or a contracted host-side
reconciliation is adopted.

## 22. MVP-4F — implementation model-profile suitability

**MVP-4F: `PASS`. Journey 6: `FAIL — blocked externally (OpenRouter
credits exhausted)`.**

From MVP-4E baseline `0e3dff9b…`, `implementation-default` alone was
overridden in the acceptance home to `anthropic/claude-sonnet-4.5`
(selected once; per-agent isolation proven — all other profiles unchanged).
The stronger model validated the whole thesis: attempt-1-valid proposals,
including an approved+applied+validated 12-file implementation and then
the exact 2-modify page-completion proposal the visual finding requires.

Three architecture defects were exposed and fixed (each followed by full
forced regression, 52/52 tasks, 2,440 pass / 1 skip / 0 fail, smoke and
freshness PASS): profile `maxOutputTokens` overrides were silently
outranked by strategy defaults (`packages/models/src/runtime.ts`);
correction eligibility compared the current state to the *pre-apply*
fingerprint and therefore could never follow a run that applied files
(now judged against snapshot post-write hashes, with a new test); and
`providerRouting` was schema-legal but unreadable from local config. One
environment reconciliation was performed: the fixture's accepted applied
files were committed (`1034625160…`, byte-identical content) after
snapshot-time git safety correctly refused to modify uncommitted targets
(`ERR_GIT_DIRTY_TARGET` — the gate working as designed).

The final three run attempts failed in ~550ms with
`ERR_MODEL_PROVIDER_FAILED`, diagnosed by direct probing as **HTTP 402 —
insufficient OpenRouter credits** ($4.64 of $5.00 used; the remaining
balance affords ≤2,392 max_tokens versus Sonnet's measured 3,475–7,285
output-token proposals). Not a product or model defect; no model mining
occurred. The correction iteration remains unexercised. Resuming requires
only an OpenRouter credit top-up, then one rerun of the canonical
`--visual-correction=once` journey.

## 23. MVP-4G — frozen baseline + low-cost final Journey 6 run

**MVP-4G: `PASS`. Journey 6 final: `FAIL — no actionable finding under
the deferred comparator measurement debt.`**

The `providerRouting` reader was audited and kept (it completes a
pre-existing schema→runtime→provider contract that config parsing alone
dropped); focused tests were added for it and for the `maxOutputTokens`
precedence fix. Full regression on the frozen baseline: build 26/26,
typecheck 44/44, lint 26/26, tests 52/52 tasks (2,445 pass, 1 skip,
0 fail), smoke and freshness PASS. Committed as `b8dc06f1…`; fresh CLI
verified.

With credits restored (bounded 8000-token probe passed, no 402),
`implementation-default` alone was overridden to
`deepseek/deepseek-v4-flash-0731` (8000/120000; all other profiles
proven unchanged). After one honest environment stop (Figma selection
drift, refused by the node-binding gate; user re-selected) and one
provider-boundary output failure (same model retried once — no
cycling), the final run `a0bc2592-…` delivered an attempt-1-valid
8-file proposal at ~$0.001 (4,573 tokens — ~60× cheaper than Sonnet),
approved/snapshotted/applied exactly, validation and independent
build/test green, real preview/Playwright captures, deterministic
comparison and live visual specialist honestly reporting the known
mobile dimension-mismatch fail.

The correction offer — now past the fixed staleness gate — terminated
truthfully at the next deterministic policy: the sole finding is not
component/frame-bound and therefore not correction-actionable, and the
true content divergence (page byte-identical to Journey 4's captures)
yields no finding because dimension mismatch skips the pixel diff. The
long-deferred dimension-normalization comparator debt is now the single
remaining prerequisite for exercising the correction loop; every other
contract on the path (authorization, eligibility, bounded proposals,
approval, snapshot, apply, validation, honesty) has been proven live.
The low-cost testing policy and the DeepSeek recommendation for
`implementation-default` are recorded in the evidence.

## 24. MVP-4H — reference-aligned deterministic visual comparison

**MVP-4H: `PASS`. Journey 6: `FAIL — blocked externally
(DEEPSEEK_UPSTREAM_LATENCY)`.**

Root cause traced precisely: the pixel diff always ran over the
top-left-aligned overlap; the loss was in finding construction, where
dimension mismatch and content divergence were mutually exclusive
branches and no deterministic finding carried frame identity. The fix
(commit `6ce904fd…`, +164/−9 across comparator, capability, and two
backward-compatible schema extensions): reference-aligned capture
viewport derived from the real Figma export's pixel size (DPR-1
contract); surfaced overlap metrics (`overlapCoverage`,
`overlapMismatchRatio`, `pixelDiffExecuted`); a 0.5 comparable-area
floor with an explicit `insufficient-comparable-area` outcome; separate
truthful size and content findings; root-frame `affectedFrame`
attribution with no fabricated components; and the actionability
distinction proven by tests (real divergence is selectable,
instrumentation-only mismatch launches no correction). Focused +7
tests; full regression 52/52 tasks, 2,452 pass / 1 skip / 0 fail;
smoke and freshness PASS; fresh pack `3e29b396…` installed.

The final live rerun was blocked by an external condition: OpenRouter's
DeepSeek upstreams currently exceed the product's hard 120s model
timeout (measured 111s success once, then three 120s timeouts; the
same model ran in 26s the previous day). The product's schema correctly
rejected a 300s override (`MAX_TIMEOUT_MS`). Per the no-mining rule no
other model was tried; four attempts all terminated pre-approval with
zero writes, the fixture stayed byte-identical (`8bc42afd…`), and no
security or process regressions occurred. Journey 6 needs exactly one
clean rerun once DeepSeek serving recovers (or a future task selects a
different low-cost implementation model).

## 25. Journey 6 final — full correction loop exercised live

**Result: `FAIL — CORRECTION_APPLIED_NO_IMPROVEMENT` — every safety and
control requirement proven at runtime; only material visual improvement
remains unmet.**

User-directed model changes: `implementation-default` →
`deepseek/deepseek-v4-pro` (empty 0-file proposal; its run nonetheless
proved the MVP-4H comparator live — reference-aligned 413×1024 capture,
pixel diff executed, 92.75% mismatch, actionable root-frame finding for
`1026:6098`) → fallback `openai/gpt-5.6-luna` (attempt-1-valid Spendly
page proposals throughout). Two further architecture defects were fixed
with green full regressions: the model-impossible sha256 hash contract
in the correction strategy (host now derives content hashes
deterministically — commit `90c09ee…`) and the structurally impossible
correction-of-own-apply under the git dirty-target gate (provenance-
backed exemption for scope- and hash-verified run-applied targets —
commit `9dcb786…`; regression 2,453 pass / 1 skip / 0 fail).

Final run: parent `ddc9cdff…`, correction child `ddcb246e…` — one
child, iteration 1 of 1, live Visual Correction Specialist on its
unchanged low-cost profile, valid hash-bound 2-modify proposal, exact
approval, correction snapshot before mutation, exact apply, validation
completed, independent build/test green, real recapture, deterministic
re-comparison, honest `no improvement` stop, and the hard one-iteration
bound held with a stored final report and one truthfully remaining
major finding. Fixture preserved (fingerprint `23c36efd…`, build/test
green); no pending state, orphans, or leaks. The single remaining step
to `PASS — CORRECTION_APPLIED_AND_IMPROVED` is a stronger
`visual-correction-default` profile (its gpt-4o-mini output was
placeholder-quality), which is a model-quality decision, not product
machinery.

## 26. MVP-4I — Qwen visual-correction model experiment

**Result: Journey 6 remains `FAIL — CORRECTION_APPLIED_NO_IMPROVEMENT`.**

Controlled single-model experiment: `visual-correction-default` →
`qwen/qwen3-coder-next` (isolation proven; implementation stayed on the
accepted luna profile). A fresh parent (`fb6d0587-…`) reached
correction eligibility honestly — notably the luna implementation
proposed real modifies to the committed SpendlyScreen files, and the
MVP-4H comparator again yielded the actionable root-frame finding. The
correction child (`74b3a177-…`) exercised the full loop a second time
(live Qwen call: 3,334 tokens, 12s, $0.00152; valid hash-bound
proposal; exact approval; snapshot; apply; validation; recapture;
honest `no improvement`; one-iteration stop). Qwen's output quality was
below the gpt-4o-mini baseline: it emitted meta-commentary as literal
file content. A process caveat is recorded: the scripted acceptance
input answered the correction approval before the mandated manual
relevance review, which would have rejected the visibly prose-only diff
pre-mutation. All safety machinery behaved correctly; the fixture's two
modified files are recoverable from commit `992d7d51…`. Qwen
`qwen3-coder-next` is rejected as a correction-profile candidate; the
next experiment needs a stronger low-cost coding model and an
un-scripted manual review at the correction approval.

## 27. MVP-4J — GLM correction experiment with un-scripted approval

**Journey 6: `FAIL — CORRECTION_PROPOSAL_REJECTED_QUALITY` (no write).**

The mandated process correction was implemented and proven: a PTY
driver halts indefinitely at the exact correction approval until a
decision is written after genuine review of the full persisted proposal
(`approval mode: manual interactive; scripted stdin: false`). The
fixture was restored to the accepted clean baseline `992d7d51…` after
discovering the prior prose contamination extended to the fb6d0587
implementation apply. With `visual-correction-default` →
`z-ai/glm-5.2` (isolation proven), parent `ab3e7457…` reached
correction eligibility honestly and child `938c99f0…` produced the
best correction proposal of the three models tested — 14KB of genuinely
executable React + token-based CSS importing the fixture's real
components (≈$0.045, 119s, two structured attempts). It was manually
rejected on the decisive relevance test: the target file is not
imported by `App.jsx`, so the change cannot alter the rendered page.
Rejection was clean and byte-verified write-free.

**Structural conclusion:** the correction scope contract (parent run's
changed files) can never reach the composition root, so the recurring
"generated UI not mounted" defect is uncorrectable by any correction
model. Correction-model tuning is exhausted per instruction; MVP-4
requires an explicit product/model strategy decision before further
Journey 6 work (widen correction scope to composition files under the
same safety contract, or require implementations to mount what they
create). GLM 5.2 is the recommended correction-profile candidate for
when that decision lands.

## 28. MVP-4K — composition-aware correction scope + final Journey 6 run

Commit `b5e9873` extended the correction scope contract: root-frame
findings now also authorize a small host-derived composition scope
(preview entry from `index.html` plus its statically imported root
components; bound `MAX_CORRECTION_COMPOSITION_FILES = 8`; provenance
`deterministic-project-inspection`; fail-closed derivation; model never
chooses the set). Enforcement, host-derived hashes, and approval binding
unchanged; the snapshot dirty-target exemption now covers only
parent-applied files. 10 focused tests; full regression 2,463 pass /
1 skip / 0 fail; smoke and freshness pass; fresh package `f46ccbab…`.

Final run: parent `c0d8ac8e` (luna, 2 applied modifies) → root-frame
finding → child `224ec164` with scope
`[SpendlyScreen.jsx, SpendlyScreen.module.css] + [src/main.jsx,
src/App.jsx]`. GLM-5.2 proposed exactly the mount correction
(`App.jsx → <SpendlyScreen />` + token-aligned css); manually reviewed
and approved un-scripted; snapshot/apply succeeded; required `build`
validation failed — the parent's own SpendlyScreen.jsx default-imports
the named-export-only `TextField`, a latent defect invisible while the
module was unmounted — and rollback restored the pre-correction state
byte-precisely. One iteration; honest stop.

**MVP-4K: `PASS`. Journey 6: `FAIL — CORRECTION_APPLIED_THEN_ROLLED_BACK
(project validation failed)`.** The correction stage is now fully proven
live; the blocker moved upstream to the recorded product debt:
implementation rendered-reachability validation (an implementation that
creates UI must build with that UI reachable from the preview entry).

## 29. MVP-4L — proposed-module compile validation + final Journey 6 run

Commit `2e2d43d` closes the MVP-4K root cause: before exact approval,
every changed executable module is compile-validated with the project's
real build tooling in a temporary workspace (project copy + node_modules
symlink + exact proposed operations + synthetic multi-module entry) even
when nothing imports it, hash-bound to the exact proposal; rendered
reachability is measured separately and unreachable-but-valid proceeds.
Compile failure is repairable inside the existing 3-attempt loop with
bounded diagnostics. 14 focused tests; regression 2,477 pass / 1 skip /
0 fail; smoke/freshness pass; fresh package `14e8472c…`.

Final run `2b695b69`: luna exhausted 3 bounded attempts (8m02s) — the
gate refused approval; zero writes, fixture fingerprint unchanged.
Direct probes against the real fixture prove the validator honest (valid
probe passes, the exact TextField latent defect fails with the real
Rollup diagnostic). New recorded debt: exhaustion `failures[]` metadata
is not persisted by the run recorder.

**MVP-4L: `PASS`. Journey 6: `FAIL —
IMPLEMENTATION_PROPOSAL_ATTEMPTS_EXHAUSTED`** — invalid unmounted code
can no longer pass the parent stage; the remaining question is
implementation-model capability under the honest gate.

## 30. MVP-4M — GLM implementation profile + final Journey 6 attempt

Configuration-only task: `implementation-default` → `z-ai/glm-5.2`
(probe OK; isolation proven via `designflow settings`; correction profile
untouched). Run `57f5595f`: attempt 1 `ERR_PROPOSAL_TARGET_EXISTS`
repaired; attempt 2 passed structural + MVP-4L compile validation with
honest `UNREACHABLE` reachability — but the manual un-scripted
implementation quality gate found the modify carried **empty content**
(would blank `src/pages/AddExpensePage.jsx`) and rejected it. Zero
writes; fingerprint unchanged (`23c36efd…`).

**MVP-4M: `PASS`. Journey 6: `FAIL —
IMPLEMENTATION_PROPOSAL_REJECTED_QUALITY (empty modify content)`.**
New recorded debt: empty-content executable modifies pass all
deterministic gates and the implementation approval prompt shows no
bounded content diff. This, plus the exhaustion-observability and
reconciliation debts, goes to the final audit; the next decision is the
Implementation Agent proposal contract (no-op rejection + approval diff).

## 31. MVP-4N — content integrity + approval diff + final Journey 6 attempt

Commit `f05dea6`: empty/whitespace executable content and byte-identical
no-op modifies are now typed, repairable pre-compile rejections; both
approval prompts render an exact bounded diff/preview (shared renderer,
120 lines / 12,000 chars, explicit truncation and blank-file warning).
15 focused tests; regression 2,492 pass / 1 skip / 0 fail; fresh package
`6f907dbb…`. Final run `b9d25a93`: GLM's attempt-1 proposal passed all
deterministic gates but was a single irrelevant 259-byte CSS module —
fully visible in the new approval review — and was manually rejected
un-scripted; zero writes (`23c36efd…` unchanged).

**MVP-4N: `PASS`. Journey 6: `FAIL —
IMPLEMENTATION_PROPOSAL_REJECTED_QUALITY (irrelevant single-CSS
proposal)`.** Model work is closed per instruction; the remaining Journey
6 blocker is the Implementation Agent proposal-generation contract
(nothing requires proposals to cover the mapped design surface).

## 32. MVP-4O — implementation coverage contract + deepest Journey 6 run

Commits `cca9f25` + `4e9487d`: host-derived required design surface
(root frame always; mapped-reuse components; bound 8; trusted reuse paths
from inspection), typed model coverage claims validated before compile,
repairable coverage codes in the 3-attempt loop, persisted
`implementation-coverage` artifact, and a coverage summary in the
approval prompt above the bounded diff. 10+ focused tests; regression
2,502 pass / 1 skip / 0 fail; fresh package `c86bf461…`.

Final run `9976ba10`: compile gate rejected attempt 1 live; attempt 2
delivered real composed Spendly UI (coverage ✓ compile ✓ unreachable —
allowed), manually approved with full visibility; applied and validated;
root-frame finding → one GLM correction child mounted it via `App.jsx`
(+2/−47, byte-verified), manually approved; **the mounted project passed
build validation live**. The child then failed environmentally at
post-correction recapture (`ERR_MCP_TIMEOUT`) and a labeled manual
capture shows the mounted page blank (NavigationMenu `items` prop
runtime crash — invisible to bundler-level validation).

**MVP-4O: `PASS`. Journey 6: `FAIL — CORRECTION_APPLIED_NO_IMPROVEMENT
(runtime prop crash; recapture unavailable)`.** New debts: Stage-6
revalidation must stop honestly on capture-infra failure; the fixture's
own `npm test` asserts the Northstar page and fails any legitimate mount.

## 33. MVP-4P — correction runtime preflight and resilient revalidation — 2026-08-08

MVP-4P addresses the two execution-truth gaps exposed by MVP-4O without changing model profiles, build validation, approval semantics, or the hard `--visual-correction=once` bound.

The correction path now validates the exact proposed state in the existing bounded temporary project workspace before presenting approval: structural/hash/scope validation, the proposed-state compile/build, bounded localhost preview plus Playwright runtime capture, then manual exact approval. The proposed state is never applied to the registered project. Compile validation remains first; a compile failure starts no preview. Runtime preflight records bounded `pageerror`, preview readiness, and missing-capture diagnostics, so the confirmed `NavigationMenu` missing-`items` failure is rejected before approval even when the project's build command succeeds.

Runtime-invalid proposals receive fact-only repair feedback and may be regenerated at most three times inside the same persisted correction iteration. Proposal attempts are not correction iterations: one approved proposal remains the only possible snapshot/apply, and the persisted iteration remains `1 of 1`. Exhaustion is typed as `ERR_CORRECTION_PROPOSAL_ATTEMPTS_EXHAUSTED`; it creates no approval, snapshot, or registered-project write. The exact preflight proposal hash is bound into the approval and rechecked at snapshot and apply.

Stage-6 revalidation now reuses a persisted trusted Figma reference when its file key, node identity, screenshot artifact identity, and provenance match. If no valid persisted reference exists, normal refresh is attempted. A bounded reference or capture infrastructure failure is persisted as an honest inconclusive gate, and the child terminates cleanly with applied/project-validation state preserved; it is not presented as visual improvement and cannot start another iteration. Gate normalization prevents the prior final-artifact conflict from turning this infrastructure outcome into a child crash.

Focused coverage includes compile-valid/runtime-invalid NavigationMenu-style proposals, repaired runtime-valid proposals, compile short-circuiting, trusted reference identity checks, and the full Stage-6 boundary suite. Forced regression totals: build 26/26, typecheck 44/44, lint 26/26, tests 2,509 passed / 1 skipped / 0 failed across 52 successful Turbo tasks; installed smoke and package freshness both pass. No live Journey 6 rerun was started because `OPENROUTER_API_KEY` was absent in the current process. No SIGINT acceptance was started.

The disposable fixture was restored to committed baseline `992d7d5` after recording the applied blank-page state. Its independent validation covered 7 files and its Vite build passed. The current inspector reports context fingerprint `97ce9bb0…`; the historical acceptance evidence's `23c36efd…` fingerprint is preserved as historical evidence.

**MVP-4P: `PASS` for the source, safety, regression, and revalidation work. Journey 6: `BLOCKED — credential not present`; no final live rerun was performed.** MVP-4K rollback acceptance remains `PASS`.

## 34. MVP-4Q — final credentialed Journey 6 acceptance — 2026-08-09

MVP-4Q was a pure acceptance run against the frozen MVP-4P source (`316fb01`, `designflow-ai@0.1.1`). No product source changed, so the accepted MVP-4P regression baseline stands. The installed CLI was stale (pre-MVP-4P dist); it was repacked from the frozen HEAD (tarball `fec53db6…`, dist `c9fb3b30…`) with preflight and coverage markers verified.

Credential gate: `OPENROUTER_API_KEY` present in the environment (presence only; value never printed or persisted). One bounded probe: HTTP 200, `z-ai/glm-5.2` responded, no 401/402, under 2 seconds. Profiles frozen and proven per `designflow settings` under the acceptance home: implementation and visual-correction both GLM 8000/120000; coordinator/figma/visual-validation at built-ins. Fixture restored to clean `992d7d5` (fingerprint `23c36efd…`), build and test both passing at baseline. Figma Desktop MCP live with frame `1026:6098` selected.

Canonical run (exactly once): parent `0cda5b14-6453-4584-982b-be1bfc23542c`. Implementation attempt 1 used a named `PrimaryButton` import and was rejected live by the proposed-state compile gate (the persisted assumptions cite the Rollup "not exported by" diagnostic as repair input); attempt 2 passed structural, content-integrity, coverage (root frame → `src/screens/AddExpenseScreen/AddExpenseScreen.tsx` proposed_change; Text field and Expense History Item via trusted existing_reuse), compile, and reachability, and was manually approved un-scripted with the coverage summary and full bounded diff displayed. Snapshot, apply, and required validation passed. Parent Stage 5 captured against a real Figma reference (`real-figma`, mcp-desktop provenance) and confirmed a major reference-aligned finding (pixel mismatch 0.9319) → correction eligible.

Correction child `9c9efb82-bdb0-42a7-967e-7c72385cfdde`, iteration 1 of 1, one proposal (`src/App.jsx` +2/−47, base `da4fe6f3…`, proposed `09c99ef7…`), MVP-4K scope. The MVP-4P runtime preflight executed and bound `preflightProposalHash 034ec5e8…` into the persisted proposal before approval. Manual un-scripted approval; snapshot; apply; mounted required build passed (in-run and independently, exit 0); `test` failed non-required on the fixture's own Northstar marker as previously disclosed. No rollback was required.

Post-correction revalidation stopped honestly as `visual_validation_inconclusive`: the fresh Stage 5 composition threw before its first seeded artifact write, the catch discarded the underlying error (not `ERR_MCP_TIMEOUT` — that maps to `reference_acquisition_failed`), and no stage-5 artifacts or `referenceSource` were persisted. The child completed cleanly (`stopped`, 1 iteration, 1 approval, 0 rollbacks) — the MVP-4P lineage-robustness promise held — but persisted-reference reuse could not be proven live and no product recapture occurred. A clearly-labeled supplementary (non-product) Playwright capture of the mounted fixture shows a complete, coherent Spendly Add Expense screen (summary cards, six-field form, expense history) with zero page errors — material movement from Northstar toward Spendly — but per policy it does not substitute for the product recapture.

Genuinely new product defect (reported, not patched): `feedback-loop-capabilities.ts` revalidation catch swallows the underlying Stage 5 exception, persisting only the reason enum with no bounded diagnostic, and the in-child fresh Stage 5 fails at/before reference seeding. A schema-level repro with the real parent report confirms the synthesized-snapshot parse itself is valid, so the failure lies in the in-child artifact-visibility/reference-resolution path.

Cleanup verified: no pending approvals, zero proposed-state or preflight temp workspaces, no preview/browser orphans, no credential or auth header in any log or persisted state (grep 0), driver and probe temp files removed. Fixture final state: `992d7d5` + applied accepted changes (`M src/App.jsx`, new `src/screens/AddExpenseScreen/`), fingerprint `2c17533c…`, build passing.

**MVP-4Q: `PASS` (acceptance exercise — criteria 1–9, 11, 12 satisfied; criterion 10 indeterminate because revalidation failed before the reference decision was recorded). Journey 6: `FAIL — CORRECTION_APPLIED_RECAPTURE_INCONCLUSIVE (product recapture did not run; supplementary evidence shows material improvement but is not product evidence)`.** MVP-4K rollback acceptance remains `PASS`. SIGINT acceptance remains unstarted.

## 35. MVP-4R — trusted visual reference handoff and revalidation diagnostics — 2026-08-09

Trace result: the parent trusted artifact was the versioned `figma-source-snapshot`. During the MVP-4Q child, `seedStage5Inputs` called `readArtifact(context, "figma-source-snapshot", ...)`; `readArtifact` searches only the child `parentArtifacts`, so the parent snapshot was invisible and raised `ERR_MISSING_UPSTREAM_ARTIFACT` before the first Stage-5 seed write. The old catch discarded that exception, producing `stage5ArtifactIds: []` and no `referenceSource`. The snapshot schema itself was valid.

MVP-4R adds an optional backward-compatible `trustedVisualReference` containing logical `artifactId`/`artifactType`, content-addressed `artifactHash`, parent image `contentHash`, Figma `fileKey`/`nodeId`, and trusted real-reference `provenance`. The parent derives it from the exact versioned snapshot/report in its execution report. The child resolves the exact payload with `artifactStore.get(artifactHash)` and verifies payload identity, logical artifact identity/type, file/node, screenshot identity/content hash, provenance, and real-Figma evidence. Valid reuse records `referenceSource: persisted` and makes no Figma MCP call. Missing/mismatched references fail closed and use the existing fresh acquisition path. Historical inputs without the field remain readable without retroactive persisted-reference proof.

Stage-5 failures now persist a bounded sanitized `{code, phase, message}` diagnostic (message maximum 500 characters; no credentials, auth headers, absolute paths, raw provider bodies, or stack traces). Final reports preserve `correctionApplied`, project-validation status, and honest visual inconclusive state after visual infrastructure failure; no screenshot is fabricated and no iteration 2 starts. Focused identity/reuse/sanitization tests, full regression, smoke, and freshness passed. The required credential gate still reports `OPENROUTER_API_KEY=missing`, so no final credentialed Journey 6 or Figma substitute run was started.

**MVP-4R: `BLOCKED_EXTERNAL — OPENROUTER_CREDENTIAL_MISSING` for live acceptance; implementation/regression gates pass. Journey 6 remains `FAIL — CORRECTION_APPLIED_RECAPTURE_INCONCLUSIVE` from MVP-4Q.** MVP-4K rollback acceptance remains `PASS`; SIGINT acceptance remains unstarted.
## 36. MVP-4R live acceptance completion attempt — 2026-08-09

The required credential gate passed in the exact launch environment:
`OPENROUTER_API_KEY=present` (presence only; the value was never printed,
read into persisted state, or dumped). One bounded provider capability probe
against `z-ai/glm-5.2` returned HTTP 200 in 5 seconds; no 401 or 402 was
observed and the request completed below 120 seconds.

The frozen product source remained `cbb918c30a58768708b03f086e1ae513906dfaa6`
on `main`, version `designflow-ai@0.1.1`. The stale installed CLI was replaced
only by repacking this exact source commit. Installed binary:
`/Users/wallex/.local/lib/node_modules/designflow-ai/dist/main.js`, SHA-256
`fccd466a55a9e39cd38150a63a91d8f8456e16fb80b68abcdf1625f91dc467e2`;
package tarball SHA-256 `41f457cf651ba0a3c47dda146d8f37b0737dd029d9e0cae8dac5ea9de7f236e1`.
The installed bundle contains the trusted-reference handoff, exact persisted
resolution, identity/hash/provenance checks, `referenceSource`, and bounded
revalidation diagnostics.

`designflow settings` proved the frozen profiles: implementation and visual
correction use OpenRouter `z-ai/glm-5.2`, max output tokens 8000, timeout
120000 ms; coordinator, Figma Specification, and Visual Validation remain on
their unchanged built-in profiles. The disposable Spendly fixture was restored
to clean HEAD `992d7d518a2394862544547a9d28deff15ed14ed`; `npm test` and
`npm run build` passed. The current inspector fingerprint is
`97ce9bb0e82b52d048de84ca533f79650aaa49d7ec56d848d260b863443a0e30`.

Figma Desktop was healthy and selected the Spendly file/frame
`E958ARSSBoJjblLhxZQVSU / 1026:6098` (`iPhone 16 Pro Max - 14`); read-only
metadata retrieval succeeded. A fresh disposable DesignFlow home was used
because the historical home contained stale interrupted executions; the fresh
home contained no prior executions, parents, approvals, or active workflows.

The first CLI prompt trial was rejected before workflow creation. The single
actual Journey 6 launch, through the canonical public command
`designflow run design-engineer --visual-correction=once`, also stopped before
workflow creation with the persisted session status `declined` and sanitized
message: `The model's answer could not be used.` Trace ID:
`c5c45f5a-45de-47e8-b5a1-fd3dbf40ba94`. No parent run ID, implementation
attempt, approval, apply, parent visual evidence, correction eligibility,
correction child, correction proposal, runtime preflight, correction approval,
correction apply, mounted validation, trusted-reference handoff, artifact
resolution, Stage 5 capture, deterministic comparison, or Visual Validation
Specialist result was produced. Product fresh-reference acquisition count is
`0` because Stage 5 was never entered.

The fixture remained byte-clean after the declined launch. The fresh home has
zero executions, zero correction parents, zero approvals, and no waiting
session. No acceptance preview/browser orphan or proposed/preflight temporary
directory was found; persisted credential, auth-header, raw-provider-response,
and unauthorized-path scans were zero. MVP-4K rollback acceptance remains
`PASS`. This run is blocked by a newly observed frozen-profile coordinator
model-output failure; no model, source, architecture, or retry mechanism was
changed. **MVP-4R: BLOCKED_EXTERNAL — COORDINATOR_MODEL_OUTPUT_INVALID.**

## MVP-4R Coordinator Entry-Gate Diagnostic and bounded relaunch — 2026-08-09

Trace `c5c45f5a-45de-47e8-b5a1-fd3dbf40ba94` used OpenRouter
`openai/gpt-4o-mini` under `design-engineer-coordinator-default`; the provider
call and classifier completed successfully. Persisted usage was 629 input,
37 output, 666 total tokens. The frozen strategy reached the generic
`productActionFromTransport(...) === undefined` decline branch. The raw model
body was not persisted, so no credential or raw response was placed in evidence.

The frozen contract uses the strict four-field coordinator schema and the
allowed actions `create_specification`, `prepare_implementation`,
`request_clarification`, and `decline`. Prompt, enum, required/nullable fields,
structured-output configuration, and parser were inspected; no deterministic
prompt/schema mismatch or parser defect was found. The coordinator has no
retry/repair behavior. The persisted successful model-call record is bounded
evidence against transport timeout, HTTP failure, empty transport, and JSON
extraction failure, but does not expose the rejected field shape.

The one isolated coordinator-only probe used the same frozen coordinator
profile/provider/model/schema/request/action computation and did not invoke the
workflow engine. It returned normalized provider success, structured extraction
PASS, schema validation PASS, allowed-action validation PASS, and
`prepare_implementation`; the host mapped it to `run_workflow`. Probe usage was
572 input, 42 output, 614 total tokens, 37.6 seconds. This temporarily proved
the original failure as **A. TRANSIENT_MODEL_OUTPUT_VARIANCE** under the
specified decision matrix.

The permitted canonical public command was then launched exactly once:
`designflow run design-engineer --visual-correction=once`. It again declined
before workflow creation. Second trace:
`a7f825a9-96fc-4f21-b116-fc4cef164230`; second model call was OpenRouter
`openai/gpt-4o-mini`, same coordinator profile, provider success, 2445.75 ms,
629 input / 31 output / 660 total tokens. No workflow engine call occurred.
This repeated unusable coordinator output changes the live gate to
**BLOCKED — COORDINATOR_OUTPUT_RELIABILITY**. Journey 6 was not rerun.

Zero-workflow proof after both declined sessions: executions `0`, feedback-loop
parents `0`, approvals `0`, and events `0`. The fixture remains at clean
`992d7d518a2394862544547a9d28deff15ed14ed` with fingerprint
`97ce9bb0e82b52d048de84ca533f79650aaa49d7ec56d848d260b863443a0e30`; tests and
build passed. No product source, prompt, schema, model, provider configuration,
or fixture was changed.
