# MVP-4 Journey 2 — Live Figma Specification

Classification: `FAIL_BLOCKING`

Timestamp: 2026-08-07
DesignFlow commit: `2c03812f729788992bc753318429cf829ddd5e58`
Package version: `0.1.1`
Acceptance home: `/tmp/designflow-mvp4-acceptance-home`
Disposable project: `/tmp/designflow-mvp4-acceptance-project`
Project baseline: `84e182895c156098bf8a046ef5cbd7eaa8075423`

## Canonical command

```text
DESIGNFLOW_HOME=/tmp/designflow-mvp4-acceptance-home designflow run design-engineer
```

The installed CLI reached the normal `Design file (homepage.fig)` prompt.
The specification-only request was not submitted because no real Figma design
or FigJam tab was available. The prompt was aborted with Ctrl+C before a
workflow execution began.

- run ID: none
- model invocation: none
- project consent: not requested
- proposal/approval/write: none
- exit: interactive prompt aborted before workflow execution

## Figma source access

The configured localhost HTTP endpoint was checked with a bounded MCP session
before completing the prompt:

- transport: HTTP
- server: Figma Dev Mode MCP Server `1.0.0`
- negotiated protocol: `2025-03-26`
- initialize: succeeded
- `tools/list`: blocked with `The MCP server is only available if your active
  tab is a design or FigJam file.`
- source/frame/node retrieved: none
- discovery session close: HTTP 200

No Figma URL, node identifier, token, authorization header, raw design payload,
or unrelated private file data was stored.

## Safety evidence

Before and after the aborted prompt:

- project `HEAD`: `84e182895c156098bf8a046ef5cbd7eaa8075423`
- project `git status --short`: clean
- project `git diff --stat`: empty
- isolated run history: 0 executions
- acceptance config: still flag-free

No coordinator or Figma Specification Specialist invocation can be claimed,
because the canonical journey never progressed past source input. No
specification artifact, trace, provenance receipt, or artifact ID was created.

## Blocking discrepancy

The real configured Figma server is reachable, but its active-tab prerequisite
is not satisfied. This is a blocking MVP-4 source-access failure under the
acceptance rules. Stop here, activate a stable real design/FigJam tab, and
rerun Journey 2 before beginning Journey 3.

## Retry — 2026-08-07

The requested rerun performed the bounded MCP preflight before starting the
canonical CLI. Results:

- initialize: succeeded
- protocol: `2025-03-26`
- server: Figma Dev Mode MCP Server `1.0.0`
- `tools/list`: failed with `The MCP server is only available if your active
  tab is a design or FigJam file.`
- diagnostic session close: HTTP 200
- canonical CLI: not started, as required after the blocking preflight failure

The disposable project remained clean at
`84e182895c156098bf8a046ef5cbd7eaa8075423`, and `designflow history` still
reported no executions. Journey 3 remains prohibited.

## URL retry — 2026-08-07

The provided source was:

`https://www.figma.com/design/E958ARSSBoJjblLhxZQVSU/Spendly?node-id=1026-6098&t=6tQdfvGxHpwUE2zF-1`

### MCP preflight and read-only retrieval

- initialize: succeeded
- protocol: `2025-03-26`
- server: Figma Dev Mode MCP Server `1.0.0`
- `tools/list`: succeeded; six tools exposed, including `get_design_context`
  and `get_metadata`
- read-only tool: `get_design_context`, node `1026-6098`
- metadata confirmation: `get_metadata`, node `1026-6098`
- safe node identity: `1026:6098`, `iPhone 16 Pro Max - 14`
- dimensions: `440×1092`
- observed child frames: `Back Button`, `Frame 1`
- MCP session close: HTTP 200

### Canonical run

- command: `DESIGNFLOW_HOME=/tmp/designflow-mvp4-acceptance-home designflow run design-engineer`
- inputs: provided Spendly URL, `react`, frame/node `1026-6098`
- artifact-only approval: approved; no project-write approval was requested
- run ID: `2d457c60-8b54-4a00-a851-f5620b8953cc`
- result: completed generic `Design → Code` run with five artifacts
- trace ID: `239425ee-cb64-4e92-b5fc-45b8c1fab3dc`
- trace result: `Model calls: 0`

### Blocking acceptance result

The run did not execute the required live coordinator or Figma Specification
Specialist. No OpenRouter provenance was recorded. The design-analysis artifact
contains only the provided URL and node component identity, not normalized live
Figma evidence. This is `FAIL_BLOCKING` under the Journey 2 criteria.

The project remained clean at
`84e182895c156098bf8a046ef5cbd7eaa8075423`, and no snapshot, apply, rollback,
or project-write path occurred. Journey 3 must not begin.

## MVP-4B remediation — 2026-08-07

**Defect: `MVP-4 BLOCKING PRODUCT DEFECT` — canonical worker dispatch bypassed
agent-centric specification routing.**

The prior run used an outdated globally installed executable and selected the
generic `design-to-code` compatibility workflow through the worker's primary
manifest entry. MVP-4B makes the Figma specification workflow the canonical
Design Engineer primary path, separates the product form from the legacy
generic form, rejects the generic workflow through public `run`, and binds
shared readiness to the same registered canonical dispatch facts.

Regression evidence on the remediated source:

- focused routing/readiness/compatibility suites: passed;
- installed smoke: passed;
- package freshness verifier: passed;
- forced build: 26/26;
- forced typecheck: 44/44;
- forced lint: 26/26;
- forced test tasks: 26/26, remote cache disabled.

No fresh live run is recorded in this section. The active execution environment
does not currently provide a non-empty `OPENROUTER_API_KEY`, so starting a
specification workflow would not prove the required live coordinator or
specialist calls. The original `FAIL_BLOCKING` classification remains in force
until the Journey 2 rerun is made with a freshly installed package and the
credential available. The project baseline has not been altered and Journey 3
remains unstarted.

## MVP-4B.1 validation reconciliation — 2026-08-07

The prior test record was corrected rather than assumed green. The doctor test
now configures Figma before runtime composition; direct runs no longer inherit
the interactive menu's artifact viewer. Final validation: build 26/26,
typecheck 44/44, lint 26/26, tests 52/52 (2,414 pass, 1 skip, 0 fail; exit 0),
smoke PASS, freshness PASS. Smoke rebuilt an isolated `designflow-ai@0.1.1`
package. No live Figma/OpenRouter call occurred; `OPENROUTER_API_KEY` is absent,
so Journey 2 remains unrun and Journey 3 prohibited.

## Journey 2 live rerun — 2026-08-07

Commit: `1ab55248ce6acadd2f9b33786bca5373d02ba047`. `OPENROUTER_API_KEY`
confirmed non-empty (value not inspected).

### Fresh CLI

- rebuilt: `npm run build` (26/26, full turbo); `apps/designflow-cli` rebuilt
  with `bun build` and `scripts/prepare-cli-package.sh --force`;
- packed: `npm pack` → `/tmp/designflow-ai-0.1.1.tgz`;
- installed: `npm install -g /tmp/designflow-ai-0.1.1.tgz --prefix
  /Users/wallex/.local` (superseded a stale copy built 2026-08-05);
- resolved executable: `/Users/wallex/.local/bin/designflow` →
  `/Users/wallex/.local/lib/node_modules/designflow-ai/dist/main.js`;
- `designflow --version`: `DesignFlow 0.1.1`.

### Project baseline (before)

- `git rev-parse HEAD`: `84e182895c156098bf8a046ef5cbd7eaa8075423`
- `git status --short`: empty
- `git diff --stat`: empty

### Figma preflight

- transport: HTTP, `http://127.0.0.1:3845/mcp`
- server: Figma Dev Mode MCP Server `1.0.0`
- negotiated protocol: `2025-03-26`
- `tools/list`: succeeded — `get_design_context`, `get_variable_defs`,
  `get_screenshot`, `get_motion_context`, `get_metadata`, `get_figjam`
- `get_metadata` for node `1026:6098`, file `E958ARSSBoJjblLhxZQVSU`:
  succeeded, returned full nested Spendly hierarchy (Back Button, Tab,
  Add Expense Form with 6 text fields + submit button, Expense History with
  5 list items, Navigation menu v3)

Isolated home `config.json` was given a `settings.figmaMcp` HTTP block
pointing at the live server. `designflow doctor` reported the credential
present, Figma configured, and Design Engineer specification readiness
`ready`.

### Canonical run

- command: `DESIGNFLOW_HOME=/tmp/designflow-mvp4-acceptance-home designflow
  run design-engineer`
- inputs: specification-only request text (no project modification), Spendly
  URL `https://www.figma.com/design/E958ARSSBoJjblLhxZQVSU/Spendly?node-id=1026-6098`,
  no frames, no project registered, no implementation consent, no workflow
  ID, no experimental flags
- first attempt (`4e298c28-03ab-49d2-a137-4b3babec8e6b`): failed input
  validation — the URL was mistakenly supplied to the "Frames" prompt instead
  of "Figma design URL"; no artifacts, no model calls, 6ms
- second attempt (`2db9a81c-6034-4751-9ce0-274cbff69b42`): completed in 39s,
  4 created artifacts, 0 reused: Parsed Figma source, Figma source snapshot,
  Design specification, Stage 3 summary

### Dispatch-path proof

History labels the run "Design → Code (Figma Specification)" under worker
"Design Engineer" — the canonical product path. No generic `design-to-code`
form, no generic Framework/Node prompt, no five-artifact scaffold, no
generic artifact-only approval appeared.

### Live coordinator and specialist (from `designflow traces`)

- Design Engineer Coordinator: role "Design Engineer", model `OpenRouter
  openai/gpt-4o-mini`, profile `design-engineer-coordinator-default`,
  status `success`, 573 in / 42 out / 615 total tokens, cost 0.00011115,
  decision: `create_specification` (no implementation selected, no write
  consent assumed)
- Figma Specification Specialist: role "Figma Specification Specialist",
  model `OpenRouter openai/gpt-4o-mini`, profile
  `figma-specification-default`, status `success`, agent version `0.2.0`,
  1154 in / 193 out / 1347 total tokens, cost 0.0002889

No deterministic fallback was used; both calls are live and independently
profiled.

### Normalized Figma evidence — blocking defect

`figma-source-snapshot` artifact: `nodes[0]` for `1026:6098` has empty
`childIds`, `fills`, `strokes`, `effects`, `properties`; `variables`,
`styles`, `components`, `assets` are all empty; two warnings recorded —
`DESKTOP_MCP_SELECTION_SCOPE` and `VARIABLES_SHAPE_UNRECOGNIZED`.

`design-specification` artifact: `hierarchy` has only the root node's
`id`/`name`; `frames` is empty; `designTokens.*`, `components`,
`layoutBehavior`, `content`, `interactions`, `states`, `ambiguities` are all
empty.

A manual `get_design_context` call made against the same live MCP session
for the same node during this run returned substantial real detail —
generated JSX with `data-node-id` attributes, CSS custom properties for
colors/spacing, and named child components (`NavigationMenuV`,
`lucide/circle-plus`) — none of which reached the persisted specification.
The deterministic parsing/mapping step fails to extract this into the
normalized snapshot, so the persisted evidence is effectively URL/node
identity only.

### Manual quality assessment vs. the real Spendly frame

- hierarchy: minor detail visible in metadata preflight, but **blocking** —
  not carried into the persisted specification (only root id/name)
- visible content/text: blocking — no text captured (six form field labels,
  expense history entries, titles all absent)
- component boundaries: blocking — zero components recorded despite five
  `Text field` and two `Button` instances, five `Expense History Item`
  instances, and a `Navigation menu v3` instance in the real frame
- alignment/spacing/colors/typography/borders/radii/shadows: blocking — all
  empty; real frame has CSS custom properties for stroke/spacing visible via
  `get_design_context`
- implementation considerations: blocking — none generated

### No-write proof (after)

- `git rev-parse HEAD`: `84e182895c156098bf8a046ef5cbd7eaa8075423` (unchanged)
- `git status --short`: empty
- `git diff --stat`: empty
- no snapshot, apply, rollback, or project-write approval occurred

### Artifact/trace/history inspection

`designflow history` shows one `failed` and one `completed` run for this
journey; no stale running execution; no pending approval. Roles are human
names ("Design Engineer", "Figma Specification Specialist"); deterministic
Figma retrieval steps are labeled as steps, not agents; provider displays as
`OpenRouter`; no generic compatibility scaffold; no credentials, raw prompts,
or provider responses recorded.

### Journey 2 classification: `FAIL_BLOCKING`

Fresh CLI, live Figma access, canonical dispatch, live coordinator, live
specification specialist, typed artifact production, and the no-write
guarantee all pass. The run fails requirements 7 and 9: normalized Figma
evidence does not carry real design facts beyond URL/node identity into the
persisted specification, and the resulting document does not clearly
describe the Spendly frame. The defect is isolated to the deterministic
Figma source-parsing/normalization step. Journey 3 must not begin.

## MVP-4C normalization fix and Journey 2 PASS — 2026-08-07

Root cause (exact): in
`packages/capabilities/figma-mcp/src/figma-desktop-adapter.ts` the adapter
(1) reduced the `get_metadata` XML-like outline — which carries the full
selected subtree with ids, names, tag types, geometry, and `hidden` flags —
to a single `{id, name, type}` literal before normalization; (2) awaited
`get_design_context` and discarded its result (six text blocks whose first
is generated React+Tailwind code with per-element `data-node-id`, visible
text, colors, radii, gaps, and font tokens); and (3) rejected the real
`get_variable_defs` shape (one JSON object of name → value in a text block)
as unrecognized. Fixture tests encoded the sparse behavior, so they passed.

Fix (files): new `parse-desktop-metadata.ts` (outline grammar → raw nested
tree → existing `normalizeFigmaNodeTree`), new
`parse-desktop-design-context.ts` (closed Tailwind token forms →
per-node-id facts; nested-element text not attributed to containers; nothing
evaluated), and `figma-desktop-adapter.ts` rewired: metadata tree is the
structural source of truth, design-context facts only fill absent fields and
never overwrite non-empty evidence with empty values, variables parse from
JSON (hex values typed `COLOR`, non-JSON still warns honestly), `INSTANCE`
nodes become component references, identity-only snapshots fail with
`ERR_FIGMA_EVIDENCE_INSUFFICIENT`, and a failed design-context retrieval
records its classified error code. The typed `figma-source-snapshot` schema
is unchanged.

Tests: 2 new test files (metadata outline, design-context facts) plus
adapter tests for hierarchy+enrichment, sparse-context non-destruction, and
insufficient-evidence failure — `@designflow/capability-figma-mcp` 78/78 —
and an agents-package integration test proving a Desktop-shaped rich
snapshot yields real hierarchy, text, spacing, and radius facts in the
specification. Full forced regression on final source: build 26/26,
typecheck 44/44, lint 26/26, test 52/52 tasks (2,430 pass, 1 skip, 0 fail,
exit 0), smoke PASS, freshness PASS.

Environment finding: two intermediate live reruns lost design context to
`ERR_MCP_TIMEOUT` — cold Desktop generation for this frame exceeds 30s (and
once 120s); warm calls take ~15s. The acceptance home's
`requestTimeoutMs` was raised to 300000.

Fresh CLI: repacked (`shasum 21e9bd793a0cb8700395e9615e724dccdb601443`) and
reinstalled to `/Users/wallex/.local/bin/designflow` →
`…/node_modules/designflow-ai/dist/main.js`; `DesignFlow 0.1.1`.

Live rerun `7578ff95-17f8-4009-aaa0-f9e56d4f5743` (55s, 4 created
artifacts): corrected snapshot has 40 nodes (root children `1026:6099`,
`1026:6104`, `1026:6137`; geometry on all), 7 text nodes ("Add
Transaction", "Expense", "Income", "Add New Expense", "Fill in the details
below to track your expense", "May 2024", "Expense History"), 14 nodes with
solid fills, radii 10/12/16, 27 layout-direction nodes, gaps 8/2/15/4, 7
Poppins typography nodes, 16 component references, 5 variables, and only
the expected `DESKTOP_MCP_SELECTION_SCOPE` warning. Coordinator: live
OpenRouter `openai/gpt-4o-mini`, profile
`design-engineer-coordinator-default`, `create_specification`, success.
Specialist: live OpenRouter `openai/gpt-4o-mini`, profile
`figma-specification-default`, success, 5,783 tokens (5,306 in — vs 1,347
pre-fix, proving rich-evidence consumption). The typed specification names
the real components with roles (Button; Text field → "Input Field"; Expense
History Item → "List Item"; Navigation menu v3 → "Navigation"), the real
palette (white, #ececec, #f9f9f9, #e4e4e4, #707070, #0000001a, #00000005),
Poppins, and all five variable names. Minor (non-blocking): the model-side
`content` list and deep-hierarchy entries summarize more tersely than the
snapshot evidence.

No-write proof: fixture HEAD `84e182895c156098bf8a046ef5cbd7eaa8075423`,
clean tree, empty diff, no untracked output, no consent/apply/rollback.
History/traces show a completed run, no stale execution, no pending
approval, provider `OpenRouter`, and no credentials/prompts/raw responses.

**Journey 2: `PASS`.** Journey 3 remains unstarted.
