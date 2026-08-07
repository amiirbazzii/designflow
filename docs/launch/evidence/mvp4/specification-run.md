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
