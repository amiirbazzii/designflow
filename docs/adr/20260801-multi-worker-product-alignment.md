# Multi-Worker Product Alignment

**Date:** 2026-08-01
**Status:** Accepted
**Stage:** 41

## Context

Stages 35–40 built a general architecture — agents, tools, model profiles,
sessions, project context and memory — that supports any number of workers.
Only one worker was ever real: Design Engineer. `qa-reviewer-agent` existed
as an unregistered architecture proof pointed at the wrong workflow. There was
no Research Analyst or Product Manager. The API exposed raw
`/api/workflows`/`/api/executions` and nothing worker-shaped. The web app was
fully workflow-centric. `WorkerManifest` had no evaluation metadata.

Stage 41 turns the architecture into a coherent four-worker product and
aligns every user-facing surface — CLI, API, web — around **Worker**, not
**Workflow**/**Agent**. It adds no new architectural layer: it fills in the
one that Stages 33–40 already built.

```
User
  → CLI / API / Web           (speaks Worker, Task, Session, Result, Project, Memory)
  → packages/product          (WorkerCatalogService, WorkerTaskRouter, AgentSessionService, WorkerResultService)
  → packages/workers          (4 WorkerManifests — metadata only)
  → packages/agents           (4 Agents — each own manifest, tools, model profile, deterministic + model strategy)
  → packages/models           (per-agent OpenRouter model profile — unchanged Stage 38 discipline)
  → workflows/*                (4 deterministic WorkflowPackages — unchanged Stage 1–31 discipline)
  → packages/core             (the execution engine — knows none of the above exists)
```

## 1. User-facing Worker vs. internal Agent and Workflow

Unchanged from Stage 33's original worker-catalogue ADR, now actually true of
four workers instead of one: a person hires a **Worker** ("Design Engineer");
a **Task** is what they ask it to do; a **Session** is the resumable
conversation that gets it done; a **Result** is what comes back. **Agent**,
**Workflow**, **Capability**, **model profile** and **tool** stay internal —
present in code, absent from CLI output, API responses, and normal errors,
except behind an explicit `{ debug: true }` request (`WorkerCatalogService`)
or a developer surface (`designflow traces`, which already existed for this
purpose since Stage 37).

## 2. Initial worker catalogue and responsibilities

Four workers, `packages/workers/src/catalog/`:

| Worker | Workflow | Agent | Responsibility |
|---|---|---|---|
| Design Engineer | `design-to-code` | `design-engineer-agent` | designs → implementation artifacts |
| QA Reviewer | `qa-review` | `qa-reviewer-agent` | reviews implementation artifacts for correctness/accessibility/consistency |
| Research Analyst | `research-analysis` | `research-analyst-agent` | bounded, supplied-source research → cited findings |
| Product Manager | `product-brief` | `product-manager-agent` | product request → typed brief with requirements/acceptance criteria |

Each `WorkerManifest` names exactly one `agentId` and one entry-point
workflow (`workflows[0]`), per Stage 33's `primaryWorkflowOf`/
`assertWorkerAgentAlignment` contract, unchanged.

## 3. Per-agent OpenRouter model ownership

Stage 38's discipline, now proven with four agents instead of two. Every
catalog agent (`packages/agents/src/catalog/*.ts`) ships its own
`AgentManifest.modelProfileId` and its own default `ModelProfile`:

| Agent | Model profile id | Default slug |
|---|---|---|
| `design-engineer-agent` | `design-engineer-default` | `openai/gpt-4o-mini` |
| `qa-reviewer-agent` | `qa-reviewer-default` | `anthropic/claude-3.5-haiku` |
| `research-analyst-agent` | `research-analyst-default` | `perplexity/sonar` |
| `product-manager-agent` | `product-manager-default` | `google/gemini-2.0-flash-001` |

Every agent ships two interchangeable `decide` strategies — deterministic
(tool-only, default, no credential required) and model-backed — selected
once at composition-root wiring time via `AgentCatalogOptions`
(`designEngineerStrategy`, `qaReviewerStrategy`, `researchAnalystStrategy`,
`productManagerStrategy`), never per-request and never by an agent guessing
whether a credential happens to be configured. `multi-agent-model-independence.test.ts`
(extended this stage to exercise the QA Reviewer's real `qa-review` allow-list
instead of a stand-in `design-to-code` one) proves against a real HTTP mock
that changing one agent's model profile, or its local override, never
touches another's request.

No worker manifest, no product service and no route names a model, provider
or credential. `packages/product`'s `WorkerCatalogService` never resolves a
model. Settings/detail commands read the same `modelAssignments` list every
surface already read since Stage 38 — extended to four entries, not
redesigned.

## 4. Central descriptor ownership

`WorkerManifest` (`packages/sdk/src/worker-manifest.ts`) is the single
source of truth for display metadata, task input fields (`inputs`),
evaluation criteria (`evaluationCriteria`), and project-context requirements
(`projectContext`). CLI (`designflow workers`/`workers <id>`/`run`), API
(`GET /workers`, `GET /workers/:id`), and web (`api.listWorkers()`/
`api.getWorker()`) all read through `packages/workers`' `BUILT_IN_WORKERS` (via
the product layer's `WorkerCatalogService`, or directly for the CLI's
in-process registry) — none hand-duplicates a worker's name, description, or
input fields. Adding a fifth worker means adding one manifest file and
registering it in three places (`BUILT_IN_WORKERS`, `BUILT_IN_AGENTS`, the
composition root's workflow-package list); every CLI/API/web surface picks it
up with no further code, per Stage 34's original goal, now actually
exercised by four workers instead of one.

## 5. Product-facing WorkerResult

New in `packages/sdk/src/worker-result.ts`: `WorkerResult`,
`WorkerResultOutput`, `WorkerEvaluationSummary`, all `.strict()`. Built in
`packages/product/src/worker-result-service.ts`
(`WorkerResultService.getWorkerResult`/`listWorkerResults`), which maps an
`ExecutionOverview` (already privacy-safe — Stage 32's `ProductExecutionService`)
plus its `ArtifactSummary[]` onto a `WorkerResult`: `workerId` resolved by
scanning the catalogue for the workflow that produced the execution
(`workers.listWorkers().find(w => w.workflows.includes(workflowId))`), never
by trusting a caller-supplied id. No agent id, workflow id, prompt,
completion or reasoning field exists on the schema — there is nothing to
accidentally serialize. A still-running or awaiting-approval execution throws
`WorkerResultNotReadyError` rather than being represented half-built; a
"result" is a finished outcome by definition, matching the SDK's own status
enum (`completed | failed | cancelled`).

## 6. Surface-alignment strategy

**CLI:** `designflow list` (Stage 33) already spoke Worker vocabulary; Stage
41 adds `designflow workers`/`designflow workers <id>` (`commands/workers.ts`),
keeps `list` as a literal alias, and leaves `run`, `sessions`, `history`,
`traces`, `projects`, `memory`, `settings` unchanged — they already resolved
generically over `context.workers.listWorkers()`, so four workers "just
worked" once registered (`scripts/cli-smoke-test.sh` proves this end to end).

**API:** new routes (`GET /workers`, `GET /workers/:workerId`,
`POST /workers/:workerId/tasks`, `GET /sessions`, `GET /sessions/:sessionId`,
`POST /sessions/:sessionId/answers`, `GET /results`, `GET /results/:resultId`)
sit beside the existing `/api/workflows`/`/api/executions/*` routes, which are
retained-but-deprecated (commented as such in `router.ts`) rather than
removed. `AgentSession`'s `agentId` field is the one thing the router strips
before returning a session (`toSafeSession`) — everything else on the schema
was already privacy-safe by Stage 39's own design.

**Web:** additive only, per the task's explicit "do not redesign the entire
UI." `api-client.ts` gained `listWorkers()`/`getWorker()` against the new
routes; a new `WorkerCatalog` screen renders alongside the existing
workflow-driven `InputForm`/`RunningView`/etc., which are untouched.

## 7. Legacy workflow compatibility

`/api/workflows/:id/start` and `/api/executions/*` keep working exactly as
before — `api.test.ts`'s pre-existing suite is unchanged except for one count
assertion (1 → 4 workflows). A run started through the deprecated route is
still discoverable through `/results/:id`: `WorkerResultService` resolves its
worker from the workflow id the same way it would for a session-started run,
so "legacy" only ever means "a workflow no current worker owns," never "not
started through a session."

## 8. Project and memory requirements per worker

`WorkerManifest.projectContext.{relevantFacts,relevantMemory}` is new,
additive, descriptive metadata — the names of the facts/memory keys a worker
draws on (e.g. QA Reviewer: `severityConventions`, `accessibilityRequirements`),
shown by `designflow workers <id>`. It grants nothing: Stage 40's
`MemoryScope`/`ProjectContextService` scoping is the sole enforcement
mechanism, structurally unchanged and re-verified this stage for all four
agents via the extended `multi-agent-model-independence.test.ts` and
`packages/product`'s existing memory/project isolation suites.

## 9. Evaluation metadata

New `WorkerEvaluationCriterion` (`packages/sdk/src/worker-evaluation.ts`):
`{ id, name, description, type: boolean|score|count, required, metadata? }`,
`.strict()`. Every worker manifest lists its own (Design Engineer's three
were added this stage too, since the spec named them explicitly). This is
typed product metadata only — no model-based grading, no deterministic
validation hook wired to block execution. `packages/workers/src/registry.test.ts`
proves every built-in worker declares at least one required criterion and
that no worker manifest carries a model/provider field.

## 10. How new workers can be added

1. Write a deterministic `WorkflowPackage` under `workflows/` (no agent/worker
   imports).
2. Write an `Agent` (manifest + default model profile + deterministic
   strategy, optionally a model strategy) under `packages/agents/src/catalog/`,
   naming only that one workflow in `allowedWorkflows`.
3. Write the `WorkerManifest` under `packages/workers/src/catalog/`, naming
   the agent and the workflow.
4. Register all three in their package's `BUILT_IN_*` list and in the
   composition root(s) (`cli-runner.ts`, `apps/designflow-api/src/host.ts`).

No CLI, API, or web file changes are required beyond that registration — the
same claim Stage 34 made for one worker, now demonstrated for four.

## 11. Why workflows remain deterministic

Unchanged from Stage 1: `workflows/*` depend on `@designflow/sdk` alone,
know nothing of workers or agents, and every capability in the three new
workflows is a pure function of its typed input — no model call, no
filesystem access beyond the artifact store, no clock, no randomness. QA
Review, Research Analysis and Product Brief all take their subject matter
(implementation items, supplied sources, product request) as **structured
workflow input**, never as something the workflow goes and fetches itself —
which is also why Research Analysis cannot browse the web: its only channel
to a source is the caller's own input array.

## 12. Known limitations

- **`apps/designflow-demo`** still wires and advertises only `design-to-code`.
  Its 30-test suite is tightly coupled to a single-workflow catalogue
  (exact menu positions, `DEMO_WORKFLOWS.toHaveLength(1)`); extending it to
  four workflows safely is real work, not touched this stage. It remains a
  workflow-level engine demo, not a Worker-vocabulary surface.
- **Evaluation criteria are metadata only.** No deterministic validation hook
  runs a criterion automatically after execution; `WorkerEvaluationSummary`
  exists on `WorkerResult` as a typed slot a future stage can populate.
- **API sessions are in-memory** (`InMemorySessionStore`), unlike the CLI's
  file-backed one — a restart of `designflow-api` loses in-flight
  clarifications, though completed executions (SQLite-backed) still survive.
- **The three new agents' deterministic strategies do not hard-gate on tool
  output** the way Design Engineer's does (`ACTIONABLE` task-type check) —
  they consult their classifier tool but treat any non-empty request as
  actionable. This matches the spec's "first version may inspect structured
  artifacts... rather than arbitrary repositories" framing but is a shallower
  decision than Design Engineer's.
- **Web is additive, not redesigned** — the new `WorkerCatalog` view is
  read-only; starting a task still goes through the legacy `InputForm` →
  `/api/workflows/:id/start` path, not the new `/workers/:id/tasks` route.

## 13. Remaining work before v1 release

- Wire `apps/designflow-demo` onto all four workers, or explicitly re-scope
  it as a single-workflow reference demo.
- Wire the web app's `InputForm`/session flow onto `/workers/:id/tasks` and
  `/sessions/:id/answers`, retiring the raw `/api/workflows` path from the
  default client entirely.
- A deterministic evaluation runner that consumes `evaluationCriteria` and
  populates `WorkerResult.evaluation` automatically after a run.
- A file/SQLite-backed session store for `designflow-api`, matching the
  CLI's persistence guarantees.
- Extend the packaged multi-worker smoke test (`scripts/cli-smoke-test.sh`)
  coverage to the API app's own tarball/deploy story, which today is
  verified only by its in-process test suite.
