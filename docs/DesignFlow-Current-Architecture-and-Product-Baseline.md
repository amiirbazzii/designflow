# DesignFlow Current Architecture and Product Baseline

**Audit date:** 2026-08-05
**Repository state:** commit `48480fa` (clean working tree apart from local tooling state under `.claude-flow/`)
**Package version:** `designflow-ai@0.1.1` (unchanged, per constraint)

Throughout this document: **[FACT]** = verified in code, **[INTERPRETATION]** = judgment from evidence, **[RECOMMENDATION]** = suggested follow-up only.

---

## 1. Executive summary

DesignFlow is, in practical terms, a **local-first, CLI-only AI workflow platform** shipping four public "AI workers" (Design Engineer, QA Reviewer, Research Analyst, Product Manager), each backed by a routing agent and a deterministic, DAG-executed workflow. On top of that public surface sits a large, **experimental, opt-in Design Engineer pipeline** (stages 3–7 of an internal roadmap) that already implements the full flagship loop the product was designed for:

```
Figma source (real MCP, stdio or Desktop HTTP) → normalized snapshot
→ Design Specification (agent) → project inspection → design-system mapping
→ implementation proposal (agent) → approval → project snapshot
→ atomic file application → validation (allow-listed commands) → rollback on failure
→ preview server → Playwright screenshots → deterministic pixel/DOM comparison
→ Visual Validation report (agent interpretation over deterministic evidence)
→ bounded, per-iteration-approved visual correction loop (agent)
```

**[FACT]** All of this exists in code, is tested (2,248 passing tests), and is gated behind explicit experimental config flags — none of it is default behavior. **[FACT]** The public defaults still never write project files; the experimental implementation/feedback-loop paths are the only write paths and each write is approval-bound, snapshot-protected, and rollback-capable.

**[INTERPRETATION]** The gap between "what the README sells" and "what the code can do" has inverted: the code is now ahead of the public product surface. The main open work is real-environment evidence (live Figma, live models, installed-package end-to-end), not architecture.

## 2. Product objective

**Problem:** generic AI coding tools generate arbitrary CSS, ignore existing design systems, break imports, don't understand monorepos, modify files uncontrolled, and leave no audit trail.

**DesignFlow's answer (as implemented):** deterministic engine executes typed workflows; agents only *decide* (route, interpret, propose) and never hold write/shell/approval authority; every output is an immutable, inspectable, lineage-tracked artifact; every project write requires explicit approval bound to exact content hashes, preceded by a snapshot, followed by validation, reversible by rollback.

**Target users:** developers, CLI-first. A future web UI is represented today only by a small `apps/designflow-web` (Vite, 7 tests) and `apps/designflow-api` (65 tests) that reuse the same product layer.

## 3. Current repository tree

```
apps/
├── designflow-cli/       # published npm package `designflow-ai` (bin: designflow)
├── cli/                  # @designflow/cli-legacy (bin: wf) — LEGACY, commander + @clack live only here
├── designflow-api/       # HTTP tier (uses storage-sqlite)
├── designflow-web/       # Vite web shell (parity experiment)
└── designflow-demo/      # scripted demo app

packages/
├── sdk/                  # ALL contracts: Zod schemas, ports, types (dependency root)
├── core/                 # ExecutionEngine, ExecutionService, reuse resolver, artifact registry impls
├── product/              # product read/write API: WorkflowRunner, sessions, traces, memory, inspection
├── agents/               # agent registries + runtimes + 9-agent catalog
├── models/               # ModelRuntime, profile/provider registries, override merging
├── model-provider-openrouter/  # the single HTTP model adapter
├── mcp/                  # generic MCP transports: stdio JSON-RPC + localhost HTTP (Desktop)
├── tools/                # agent decision-time tools (classifiers etc.)
├── workers/              # worker manifests (the public catalog)
├── artifacts/, state/    # small foundational packages
├── storage-file/         # CLI persistence (single JSON doc under DESIGNFLOW_HOME)
├── storage-sqlite/       # API-tier persistence
└── capabilities/
    ├── figma-mcp/        # Figma parsing/discovery/retrieval/screenshot capabilities
    ├── implementation/   # Stage 4: inspection, mapping, proposal, approval binding,
    │                     #   snapshots, application, validation, git-safety, write-lock
    └── test-artifact/    # minimal capability fixture

workflows/
├── workflow-design-to-code/   # 5 workflow definitions (see §8)
├── workflow-qa-review/ | workflow-research-analysis/ | workflow-product-brief/
└── workflow-test/

docs/adr/                 # 32 ADRs incl. stage-4/5/6/7 records
scripts/cli-smoke-test.sh # isolated npm-pack install smoke test
```

## 4. Current technology stack

**Currently implemented [FACT]:**
- TypeScript (strict, `exactOptionalPropertyTypes`), Bun runtime + workspaces, Turborepo, Zod everywhere, ESLint.
- OpenRouter as the only model provider (`packages/model-provider-openrouter`), incl. flat structured-output response handling (commit `086b0fb`).
- MCP: stdio JSON-RPC transport **and** a localhost-only Streamable-HTTP transport for Figma Desktop (`packages/mcp/src/http-runtime.ts` — hosts restricted to `127.0.0.1`/`localhost`, line 33/526).
- Playwright for browser capture — root devDependency + **optionalDependency of the CLI** (`apps/designflow-cli/package.json`: `"playwright": "1.62.1"`); absence degrades to `renderer_unavailable`, never a false pass (stage-5 ADR).
- Deterministic image comparison: in-house `png-rgba-pixel-diff-v1` (`workflows/workflow-design-to-code/src/visual-validation-types.ts:69`) — no pixelmatch dependency.
- Local persistence: JSON document store under `DESIGNFLOW_HOME` (`packages/storage-file`), schema v1 with quarantine-on-corruption (Stage 7 ADR).
- SQLite (`packages/storage-sqlite`) — used by `apps/designflow-api`, not the CLI.

**Partially implemented:**
- Web UI parity (`designflow-web`, `designflow-api` exist and test green, but are far behind the CLI surface).
- Real-environment verification: fake MCP server + mocked OpenRouter cover almost everything; live-Figma/live-model evidence is explicitly outstanding (Stage 7 ADR "Release status").

**Planned but not active [FACT — zero references in `apps/designflow-*`, `packages/`, `workflows/`]:**
- Supabase (no code at all), `@ast-grep/napi`, `ts-morph` (project inspection in `packages/capabilities/implementation/src/inspection.ts` is hand-rolled fs walking, not AST-based).

**Legacy/compatibility-only:**
- `apps/cli` (`@designflow/cli-legacy`, bin `wf`) — the only place `commander` and `@clack/prompts` exist. The shipped CLI (`apps/designflow-cli`) uses a hand-rolled dispatcher (`src/cli.ts`) and a `Terminal` abstraction.
- `design-engineer-agent` (v0.3.0) retained as a compatibility alias behind `design-engineer-coordinator`.

## 5. Package responsibilities

| Package | Responsibility | Public API (selection) | Depends on | Used by |
|---|---|---|---|---|
| `@designflow/sdk` | All contracts/schemas/ports | `Capability`, `CapabilityContext`, `WorkflowDefinition`, `ArtifactRegistry`, `McpClient`, `AgentInvocationService`, agent/model/tool/session/trace/reuse schemas, design-engineer + visual-validation contracts | zod | everything |
| `@designflow/core` | Deterministic engine | `ExecutionEngine`, `ExecutionService`, `CapabilityRegistry`, `createArtifactFingerprintReuseResolver`, in-memory stores, planners, reconcilers | sdk, artifacts, state | product, workflows(dev), apps |
| `@designflow/product` | Product-layer API | `WorkflowRunner`, `AgentSessionService`, `WorkerTaskRouter`, `TraceService`, `ArtifactInspectionService`, memory/project services | sdk | CLI, api, web, demo |
| `@designflow/agents` | Agent catalog + runtimes | `AgentRuntime` (decide), `AgentInvocationRuntime` (perform), both registries, 9 agents + strategies + default model profiles | sdk | CLI, product(dev), workflows(dev) |
| `@designflow/models` | Model runtime | `ModelRuntime`, profile/provider registries, `mergeModelProfileOverrides` | sdk | CLI |
| `@designflow/model-provider-openrouter` | The one HTTP model adapter | `OpenRouterProvider` | sdk | CLI |
| `@designflow/mcp` | Generic MCP transports | `McpRuntime` (stdio), HTTP runtime, `MCP_ERROR_CODES`, fake server | sdk | CLI; figma-mcp/workflows (dev) |
| `@designflow/capability-figma-mcp` | Figma interpretation | `parseFigmaSource`, `discoverFigmaMcpCapabilities`, `buildFigmaSourceSnapshot`, 2 capabilities | sdk | workflow-design-to-code |
| `@designflow/capability-implementation` | Stage-4 write machinery | inspection, mapping, proposal, approval binding, `rollbackProjectSnapshot`, application, validation, git-safety, `project-write-lock` | sdk | workflow-design-to-code |
| `@designflow/tools` | Decision-time tools | `ToolRuntime`, classifier catalog | sdk | CLI |
| `@designflow/workers` | Worker catalog | 4 manifests, `createWorkerRegistry` | sdk | CLI, product(dev) |
| `@designflow/storage-file` | CLI persistence | `FileStore` + 12 file-backed adapters incl. `FileFeedbackLoopParentStore` | sdk | CLI |
| `@designflow/storage-sqlite` | API persistence | SQLite adapters | sdk | designflow-api |
| workflow packages | Workflow definitions + capabilities | `WorkflowPackage`s + policies | sdk (+capability pkgs) | CLI |

**Ownership notes [INTERPRETATION]:** boundaries are unusually clean and mechanically enforced (every major package has an `architecture.test.ts` scanning imports). Two mild overlaps: (a) `hashContent` exists in both sdk and core (documented duplication from Stage 1); (b) `workflows/workflow-design-to-code` has grown very large (5 workflows, ~40 source files) and hosts the visual-validation runtime (`visual-validation-runtime.ts` spawns preview servers/Playwright) — arguably capability-package material.

## 6. Runtime architecture (actual request flow)

```
designflow run design-engineer
→ apps/designflow-cli/src/cli.ts (hand-rolled dispatch, case "run")
→ commands/run.ts → collectInput (worker manifest fields)
→ CliContext.sessions (AgentSessionService) .startSessionForWorker
→ WorkerTaskRouter.routeWorker → AgentRuntime.decide (coordinator agent)
   — task validated, tools/model narrowed to manifest ∩ installed,
     decision re-validated + checked against allowedWorkflows
→ decision run_workflow → WorkflowRunner.start → ExecutionService.execute
   (packages/core/src/application/execution/execution-service.ts)
   — policy evaluation (require_approval rules) may park run as waiting_approval;
     per-node approval gate lives in the engine (engine.ts nodeApprovalFor)
→ ExecutionEngine.run: compile DAG → per-node reuse fingerprint check
   (createArtifactFingerprintReuseResolver) → CapabilityRunner.run per node
   — CapabilityContext carries artifactStore (lineage-wrapped), signal,
     and the two optional ports: `agents` (AgentInvocationService) and `mcp` (McpClient)
→ capabilities write artifacts (content-addressed payload + stable logical id + version)
→ approval (CLI prompt → FileApprovalManager → resumeAfterApproval)
→ completion report + "designflow artifacts <run-id>" inspection (redacted, truncated)
```

The composition root — the only file allowed to import concrete infrastructure — is `apps/designflow-cli/src/services/cli-runner.ts` (`createCliContext`, ~1000 lines). It decides once, at wiring time: model mode (`OPENROUTER_API_KEY` present → model strategies; else deterministic), Figma MCP transport (stdio command vs Desktop localhost HTTP, from `figma-mcp-config.ts`), and which experimental workflows to register.

CLI commands (from `cli.ts` switch): `run, list/workers, history, artifacts, traces, sessions, answer, cancel, settings, projects, memory, cleanup, doctor, feedback-loop` (+ interactive menu).

## 7. Agent architecture

Two agent kinds, two registries, two runtimes — deliberately separate:

**Routing agents** (`Agent.decide` → `run_workflow | request_clarification | decline`; `InMemoryAgentRegistry` + `AgentRuntime`, both allow-list-enforced):

| ID | Version | Profile (default model) | allowedWorkflows | Tools | Status |
|---|---|---|---|---|---|
| `design-engineer-coordinator` | 0.1.0 | `design-engineer-coordinator-default` (`openai/gpt-4o-mini`) | design-to-code, design-to-code-implementation, design-to-code-figma-specification | classify-design-task | production (worker entry) |
| `design-engineer-agent` | 0.3.0 | `design-engineer-default` (`openai/gpt-4o-mini`) | same three | classify-design-task | compat alias (separately registered, not a redirect) |
| `qa-reviewer-agent` | 0.2.0 | `qa-reviewer-default` (`anthropic/claude-3.5-haiku`) | qa-review | 2 tools | production |
| `research-analyst-agent` | 0.1.0 | `research-analyst-default` (`perplexity/sonar`) | research-analysis | 2 tools | production |
| `product-manager-agent` | 0.1.0 | `product-manager-default` (`google/gemini-2.0-flash-001`) | product-brief | 2 tools | production |

**Specialized agents** (`SpecializedAgent.perform` → typed artifact; `InMemorySpecializedAgentRegistry` + `AgentInvocationRuntime`; invocable **only** by workflow capabilities via `context.agents` — no agent-to-agent path exists structurally):

| ID | Version | Profile | Consumes → produces | Tools |
|---|---|---|---|---|
| `figma-specification-agent` | 0.2.0 | `figma-specification-default` | FigmaSourceSnapshot → DesignSpecification (fabricated node-ids rejected) | none |
| `implementation-agent` | 0.1.0 | `implementation-default` | spec+context+mapping → plan + typed file proposal | none |
| `visual-validation-agent` | 0.1.0 | `visual-validation-default` | deterministic findings → bounded interpretation (unknown evidence ids rejected) | none |
| `visual-correction-agent` | (see file) | `visual-correction-default` | selected findings → Zod-validated correction plan + exact content changes | none |

All 8 have deterministic + model-backed strategies chosen once at composition; every agent's model profile is independent; every profile is overridable via `settings.models.profiles` in config. "Independently invokable": routing agents via `routeTask`/sessions; specialized agents via `AgentInvocationRuntime.invoke` (host-constructed) — there is no public CLI command to invoke one directly [FACT].

## 8. Workflow architecture

All in `workflows/workflow-design-to-code/src` unless noted; public/production first:

1. **`design-to-code`** (public, default) — 5 deterministic nodes (analyze-design → tokens → component-tree → generate-code → validate-output), approval on `generate-code`, artifacts-only output. Unchanged since Stage 1.
2. **`qa-review`**, **`research-analysis`**, **`product-brief`** — the other public workers' workflows (own packages, own approval policies).
3. **`design-to-code-agent-foundation`** (internal, Stage 2 proof; harness-only, never CLI-registered).
4. **`design-to-code-figma-specification`** (experimental; flag `experimental.designEngineerFigmaMcp`) — parse → retrieve snapshot (MCP) → spec agent → summary.
5. **`design-to-code-implementation`** (experimental; `settings.experimental.designEngineerImplementation === true` via `readExperimentalImplementationEnabled`, requires a registered project) — 23 nodes spanning Stage 4+5: `implementation-workflow.ts:2` — spec pipeline → `inspect-registered-project` → `map-design-system` → `invoke-implementation-agent` → plan/proposal artifacts → `request-implementation-approval` → `create-project-snapshot` → `apply-approved-file-changes` → `run-project-validation` → `store-generated-implementation` → preview/capture/DOM-evidence/reference/`compare-visual-evidence` → `invoke-visual-validation-agent-stage5` → report + stage summaries. Approval policy targets `create-project-snapshot` (`implementation-manifest.ts:7`).
6. **`design-to-code-feedback-loop`** (internal, Stage 6; CLI command `feedback-loop`; gated by the **same** `designEngineerImplementation` flag — there is no separate loop flag) — 16 nodes (`feedback-loop-workflow.ts:14-29`): finding selection → correction agent → plan/proposal → approval → `create-correction-snapshot` (the approval target) → **`consume-correction-approval`** (burns the one-shot approval token so it cannot be reused across iterations) → apply → validate → **rerun Stage 5** → deterministic evaluator → durable parent record (`FileFeedbackLoopParentStore`) decides whether another bounded iteration is permitted. Limits: default 3 iterations, hard schema ceiling 8 (`packages/sdk/src/visual-correction-contracts.ts:8-14`), 5 files / 200 KB changed bytes / 0 dependency changes per iteration; the limit is enforced both in `evaluate-feedback-loop` and in the CLI parent driver (`commands/feedback-loop.ts`). Each iteration is its own child execution with its own exact approval.

## 9. OpenRouter architecture

```
Agent strategy → context.model.generate (AgentScopedModelService — profile-bound,
   budget-capped, #private-field-sealed)
→ ModelRuntime.generate (packages/models/src/runtime.ts — validate request,
   resolve profile → provider, enforce timeout/abort, validate response envelope,
   normalize errors to ERR_MODEL_* codes)
→ OpenRouterProvider (packages/model-provider-openrouter/src/provider.ts —
   /chat/completions, response_format json_schema "designflow_structured_output",
   now also accepting flat structured outputs; rejects invalid JSON with
   ERR_MODEL_OUTPUT_INVALID, maps schema rejection at provider.ts:337)
→ caller re-validates output with its own Zod schema (double validation, by design)
```

- **Credential:** read exactly once, `cli-runner.ts:507` (`process.env["OPENROUTER_API_KEY"]`); provider constructor rejects empty keys; no key field exists on `ModelProfile` structurally. `doctor` reports presence without inspecting the value (`doctor.ts:88`).
- **Selection:** manifest `modelProfileId` → `InMemoryModelProfileRegistry` built from 9 `BUILT_IN_MODEL_PROFILES` (`cli-runner.ts:235-249`) merged with per-profile config overrides (`mergeModelProfileOverrides` precedence: config override field-patch > built-in default; unknown id → hard error). Only `providerId`, `model`, `temperature`, `maxOutputTokens`, `timeoutMs` are overridable from local config — `fallbackModels`/`providerRouting` deliberately are not (`packages/models/src/config.ts:32`).
- **Structured-output pre-flight (commit `086b0fb`):** OpenRouter's strict json_schema path rejects top-level `oneOf`, so decision responses now travel as a flat transport schema converted via `modelDecisionFromTransport`, and the provider exposes `responseSchemaIssues` (`provider.ts:359`) which `ModelRuntime` checks **before** any HTTP call, failing with the new `ERR_MODEL_SCHEMA_UNSUPPORTED` (HTTP 400 also re-mapped to it).
- **Profile capabilities [FACT, `packages/sdk/src/model.ts`]:** `temperature`, `maxOutputTokens` (≤32k), `timeoutMs` (≤120s), `fallbackModels` (explicit list, provider-routed), `providerRouting {order, allowFallbacks, dataCollection}`.
- **Tracing:** per-call `model.request.started/completed/failed` trace events carrying profileId, providerId, model, durationMs, and token `usage` (input/output/total/cost when reported) — `packages/sdk/src/trace.ts`, emitted from `AgentRuntime`.
- **No bypasses [FACT]:** the only non-localhost `fetch` to a model endpoint lives in the OpenRouter provider; a grep for provider usage outside that package finds none. There is **no cross-request retry loop** anywhere — failures decline safely (this is deliberate: "no autonomous retries" is a standing rule; `fallbackModels` is the only sanctioned failover and it is provider-side).

## 10. State and artifact architecture

- **Home:** `DESIGNFLOW_HOME` (default `~/.designflow`): `config.json`, one `runs.json` document (all collections), `history/`, `cache/`. `FileStore` = atomic-rename + exclusive lock + corrupt-file quarantine (Stage 7).
- **Artifacts:** dual identity — content-addressed payload id (SHA-256 of canonicalized JSON) + stable logical id (`design-specification`, …) with monotonically versioned `ArtifactVersion` records, provenance (executionId/workflowId/capabilityId), typed relations/lineage graph. Screenshots stored as base64 **payloads only** — metadata (node, format, dimensions, hash) is what surfaces in inspection/history; `designflow artifacts` never prints image bytes.
- **Reuse:** per-node fingerprint = hash(input, capability id+version, workflow id+version, dependency artifact versions, `REUSE_SCHEMA_VERSION`, host `ReuseIdentity` {projectId, projectContextFingerprint, modelProfileId, agentVersion, plus seven Figma-identity fields incl. `figmaCacheBypass` — the nonce behind `designflow run --no-cache`}) stamped on artifacts and compared by `createArtifactFingerprintReuseResolver` (reuse additionally requires the impact-analysis closure to miss the node). Pre-scheme artifacts never reuse. Stage-4 side-effect and validation nodes are never reused against stale project state (Stage 4 ADR).
- **Resume:** `ExecutionService.resume`/`resumeAfterApproval` from checkpoints; the Stage-6 loop adds a durable parent record for cross-execution continuation.
- **Provenance:** every agent-produced artifact carries agent id+version+profile; visual evidence carries reference provenance labels `real-figma | fake-mcp | synthetic` (commit `10c7fec` specifically hardened this so fake evidence can't masquerade as real).

## 11. Security and safety boundaries

- **Approval:** `require_approval` policy rules pause runs (`waiting_approval`); Stage-4/6 approvals bind exact proposal artifact hash, project id + base fingerprint, file/dependency counts, iteration, expiry (`packages/capabilities/implementation/src/approval.ts`; Stage 6 ADR). Rejection terminates before any snapshot/write.
- **The only project write path:** `packages/capabilities/implementation/src/application.ts` — canonical-root containment, relative-path/symlink/deletion checks, base-hash re-verification at apply time, temp-file + atomic rename, snapshot persisted under DesignFlow state, `rollbackProjectSnapshot` (refuses if files changed externally post-write unless forced), plus a `project-write-lock.ts` guarding concurrent writers and `git-safety.ts` blocking dirty-target/merge-in-progress writes.
- **Command execution:** exactly three spawn sites in production code [FACT]: MCP stdio server (`packages/mcp/src/stdio-runtime.ts`), project validation (`implementation/src/validation.ts:22` — allow-listed executables, `shell:false`, timeouts, bounded redacted output), preview server (`visual-validation-runtime.ts:301` — project-declared scripts only, `shell:false`, bound to `127.0.0.1`, ephemeral port).
- **MCP restrictions:** HTTP transport hard-restricted to `http://127.0.0.1|localhost` (`http-runtime.ts:526`); agents cannot name MCP tools (capability adapters own tool selection); response size caps; typed `ERR_MCP_*` failures.
- **Credentials:** never in config values (`envPassthrough` names variables; values resolved from `process.env` at spawn only), never in artifacts/traces/errors (redaction: `redactSensitive` in product inspection, `looksSecretLike` in sdk privacy, dedicated leak tests in `figma-mcp-experimental.test.ts`, `adversarial-concurrency.test.ts`).
- **Fail-closed:** missing Playwright → `renderer_unavailable`, never a pass; missing reference → `inconclusive`, never fidelity-pass; failed required validation → snapshot rollback + no success artifact; malformed model output → typed decline, never partial acceptance.
- **Known caveats [FACT]:** (a) a `require_approval` target scoped **only** by `workflowId` matches nothing — `targetMatches` (`packages/core/src/policy/in-memory-policy-evaluator.ts:117-129`) requires a nodeId or capabilityId, and resource-limit rules are parsed but unenforced; (b) nothing wires SIGINT to the root `AbortController`s, so cancellation is effectively timeout-driven at the leaves; (c) the stdio MCP transport spreads the **full** `process.env` into the child before adding `envPassthrough` vars (`packages/mcp/src/stdio-runtime.ts:99`) — the allowlist governs additions, not the baseline — and, unlike the HTTP transport, does not verify the negotiated protocol version.

## 12. Test and build status (exact, run 2026-08-05)

| Check | Result |
|---|---|
| `bun run build` | **26/26 packages pass** |
| `bun run typecheck` | **44/44 tasks pass** |
| `bun run lint` | **26/26 pass** |
| `turbo run test --continue --force` | **52/52 tasks pass — 2,248 tests pass, 1 skip, 0 fail** |

Notables: the skip is a live-OpenRouter test (env-gated). The formerly-failing empty `capability-test-artifact` test task now passes. Largest suites: cli 260, core 434, sdk 292, agents 233, product 221, design-to-code 92. The full `scripts/cli-smoke-test.sh` (isolated npm-pack global install) also passed in the previous session against this build lineage; it exercises the published-package journey end to end.

## 13. Current vs. intended architecture

The intended five reusable agents map to what exists as follows:

| Intended | Current | Gap |
|---|---|---|
| Project discovery / tech-stack agent | **Deterministic capability** (`inspect-registered-project`), not an agent | Intent shifted (Stage 4 ADR): inspection is bounded/deterministic by design. No AST tooling (ts-morph/ast-grep) — inspection is convention/fs-based |
| Figma-to-document agent | `figma-specification-agent` v0.2.0 | Exists; real-Figma verification outstanding |
| Document-to-code agent | `implementation-agent` v0.1.0 | Exists; experimental-only |
| Visual comparison agent | deterministic compare + `visual-validation-agent` | Exists; deliberately split deterministic/AI |
| Manager/orchestrator agent | `design-engineer-coordinator` routes only; the **engine** orchestrates; Stage-6 continuation is a deterministic evaluator | The "manager agent" is intentionally *not* an agent — orchestration authority stays deterministic |

Other deltas: public default worker still runs the Stage-1 placeholder pipeline (experimental paths are not the default); Supabase/web parity unstarted; per-agent model config exists but only via config-file overrides (no CLI command to set them); no cost-budget enforcement (usage is traced, not limited).

## 14. Structural risks and technical debt

1. **README/product-surface lag** — `README.md:148` still says "does not yet connect to the Figma API" unconditionally; true only for the *default* path. [RECOMMENDATION: reconcile]
2. **`workflows/workflow-design-to-code` is overgrown** — 5 workflows + a browser/preview runtime (`visual-validation-runtime.ts`, spawns processes) inside a "deterministic, SDK-only" workflow package; its architecture test needed carve-outs. [INTERPRETATION: highest-value refactor target]
3. **Reuse blind spot for live documents** — a Figma document change with identical input cannot auto-invalidate the snapshot; `refreshFigmaSource` is a manual escape hatch (documented in `20260810` ADR §7).
4. **`hashContent` duplicated** (sdk `content-hash.ts` vs core artifacts) — divergence risk.
5. **Legacy `apps/cli`** still builds/tests in CI paths while being superseded — carrying cost.
6. **Composition root size** — `cli-runner.ts` ~1000 lines wiring everything; correct pattern, growing fragile. Turbo cache under-invalidation of the CLI bundle remains a known operational trap (must `--force` before release verification).
7. **Unverified-in-real-environment claims** — Stage 7 ADR itself gates release on live Figma/model/installed evidence that does not yet exist; nothing in-repo can substitute for it.
8. **No cost controls** — model budgets are per-decision call-count caps (3), not token/cost limits.
9. **CLI package manifest is empty** — `apps/designflow-cli/package.json` declares zero `dependencies` (only optional `playwright`) while its source imports ~18 workspace packages; it works only because the build bundles. The published package's dependency graph is invisible to npm audit. Its `tsconfig.json` `references` are also out of sync with actual imports (missing artifacts, state, storage-sqlite, capability-figma-mcp).
10. **Policy evaluator gaps** — workflowId-only approval targets silently match nothing; resource-limit rules are inert (see §11 caveats).
11. **Cancellation gap** — no SIGINT → abort wiring anywhere in the CLI.
12. **stdio MCP env inheritance** — the spawned server inherits the full parent environment (`stdio-runtime.ts:99`); `envPassthrough` is additive, not restrictive.
13. **Screenshot payloads inflate the single JSON store** — every base64 screenshot lands in `history/runs.json` (no blob sidecar), and each `FileStore.mutate` rewrites the whole document.
14. **Contract duplication with an unsafe cast** — the Stage-2 `visualValidationReportSchema` (`packages/sdk/src/design-engineer-contracts.ts:491`) coexists with the live Stage-5 contract, bridged via `as unknown as VisualValidationReport` in `visual-validation-agent.ts:124,169` — the one confirmed violation of the "no unsafe casts" rule.
15. **Documentation drift** — `docs/adr/README.md` stops at the Figma-MCP ADR (misses all four stage-4/5/6/7 records), and the Figma Desktop HTTP transport (`packages/mcp/src/http-runtime.ts`) has no ADR at all. Minor dead code: the `maxIterations <= 1` branch in `evaluateFeedbackLoopCapability` is unreachable.

## 15. Confirmed baseline (safe facts for a new engineer)

1. Everything typed flows through `@designflow/sdk`; every package's import boundary is enforced by an `architecture.test.ts`.
2. `apps/designflow-cli/src/services/cli-runner.ts` is the sole composition root; mode decisions (model, MCP transport, experimental flags) happen once, at wiring time, never per-request.
3. Agents decide/interpret only. All authority — execution order, approval, writes, shell, retries, loop limits — is deterministic engine/capability code.
4. There are exactly two agent kinds: routing (`decide`, 5 registered) and specialized (`perform`, 4 registered), with separate registries and runtimes; agents cannot invoke agents.
5. Every agent has its own model profile; all 9 profiles are registered in `cli-runner.ts:235` and individually overridable via `settings.models.profiles`; the only credential read is `OPENROUTER_API_KEY` at `cli-runner.ts:507`; the only provider is OpenRouter.
6. The default `design-to-code` workflow never touches the user's project. The only write path is the experimental Stage-4/6 machinery in `packages/capabilities/implementation`, always: approval (hash-bound) → snapshot → atomic apply → validation → rollback-on-failure.
7. Persistence is a single JSON document under `DESIGNFLOW_HOME` via `FileStore` (atomic rename, lock, quarantine); artifacts are content-addressed payloads + versioned logical ids with lineage; reuse is fingerprint-based per Stage 1's scheme.
8. MCP transports: stdio (spawned command) and localhost-only HTTP (Figma Desktop). Playwright is optional; its absence is reported honestly.
9. Version is `0.1.1` and must stay there; the package deliberately remains unreleased pending real-environment evidence (Stage 7 ADR).
10. Current health: build 26/26, typecheck 44/44, lint 26/26, tests 2,248 pass / 1 skip / 0 fail.
