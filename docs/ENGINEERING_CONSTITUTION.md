# DesignFlow Engineering Constitution

**Version:** 1.1.0  
**Status:** Active  
**Author:** Founding Architect  
**Scope:** Universal across all DesignFlow core packages, SDK, CLI, workflows, and extensions.

---

## 1. Project Mission and Architectural Philosophy

### 1.1 Project Mission
DesignFlow is a universal, deterministic, capability-driven workflow compilation and execution engine. Its primary objective is to seamlessly transform high-level design specifications, UI assets, and design system tokens into production-ready software artifacts with total auditability, strict safety guarantees, and zero unvalidated mutations.

### 1.2 Architectural Philosophy
- **Compilation Over Mutation:** Workflows are executed as deterministic compiler pipelines. System transformations pass through distinct lexical analysis, AST/Intermediate Representation (IR) construction, planning, transformation, validation, and emission phases.
- **Strict Domain Decoupling:** The kernel (`@designflow/core`) is completely domain-agnostic. Domain knowledge (such as Figma API structures, React AST manipulations, Git ops, or CSS token transforms) is strictly encapsulated within specialized capability and workflow modules.
- **Immutable Artifact Traceability:** Every execution step ingests immutable inputs and produces content-addressed, schema-validated artifacts. State transitions are pure functions of previous state and newly committed artifacts.
- **Transactional Safety:** Target environments must never be left in a corrupted or half-mutated state. Any validation failure or execution abort must gracefully clean up candidate artifacts without side effects on target systems.
- **Native Host Execution (No Docker):** All engine components, core schedulers, and workflow capabilities execute natively using the Bun runtime on host environments. Docker containers are neither required nor permitted for workflow execution or tool orchestration.
- **Bring Your Own Key (BYOK):** All integrations with external services (LLM providers, Figma APIs, GitHub APIs, third-party platforms) operate on a strict BYOK model. Credentials must be passed dynamically via execution context or user-configured environment variables; no hardcoded keys or proxy gateway assumptions exist in core.

---

## 2. Non-Negotiable Principles

### 2.1 Capability-Driven Architecture
- A **Capability** is a self-contained, strongly-typed atomic unit of work with explicitly declared inputs, outputs, prerequisites, and side-effects.
- Core engine schedulers interact with capabilities exclusively through standardized SDK contracts. Core code MUST NEVER contain hardcoded capability logic or assumptions about specific capability implementations.

### 2.2 Domain-Agnostic Workflow Engine
- `@designflow/core` MUST NOT contain references to specific UI frameworks, design tools, file formats, or third-party APIs.
- Core engine primitives operate solely on Directed Acyclic Graphs (DAGs), state graphs, execution contexts, state snapshots, and generic artifact IDs.

### 2.3 Compiler Pipeline Model
All complex workflows must be structured as a sequence of deterministic compiler passes:
1. **Parse / Ingest:** Read raw design assets or input sources into strongly-typed Intermediate Representations (IR).
2. **Analyze / Optimize:** Inspect IR, check semantic rules, perform graph transformations, and resolve dependencies.
3. **Plan:** Synthesize an execution candidate diff without mutating external environments.
4. **Transform / CodeGen:** Generate code, assets, or configuration payloads in temporary candidate storage.
5. **Emit / Apply:** Validate candidate outputs against schemas/assertions and write changes to the target destination.

### 2.4 Plan → Execute → Validate → Apply Lifecycle
Every state-modifying action in DesignFlow MUST strictly follow this 4-phase lifecycle:
1. **Plan:** Inspect source state and destination target; construct a precise diff/execution plan. No side effects.
2. **Execute:** Perform computation and asset generation in an isolated staging space. Intermediate outputs are saved as uncommitted candidate artifacts.
3. **Validate:** Subject candidate artifacts to structural Zod schema checks, static analysis, linting, or custom validation rules.
4. **Apply:** Atomically commit validated candidate artifacts to the destination environment (e.g., target file system, version control, or remote repository).

### 2.5 Artifact-First State Management
- All intermediate states, diffs, candidate outputs, and final deliverables MUST be stored as immutable artifacts managed by the artifacts system (`@designflow/artifacts`).
- Artifacts are uniquely identified using generic content-addressable identifiers (content hashes).
- Direct, untracked writing to the target file system during workflow execution is strictly prohibited.

### 2.6 Framework & SDK Isolation Rules
- UI framework libraries (e.g., React, Vue, Svelte, Tailwind, Figma Plugin API) MUST be isolated inside dedicated workflow or provider packages.
- **Vercel AI SDK Isolation:** Usage of the Vercel AI SDK (`ai`, `@ai-sdk/*`) MUST be restricted exclusively to specialized AI capability packages or domain workflows. `@designflow/sdk`, `@designflow/core`, `@designflow/artifacts`, and `@designflow/state` MUST NEVER import Vercel AI SDK modules.
- `@designflow/sdk`, `@designflow/core`, `@designflow/artifacts`, and `@designflow/state` MUST remain completely framework-agnostic.

### 2.7 Internal Orchestration via LangGraph JS
- `@designflow/core` utilizes **LangGraph JS** internally for state graph construction, node transition management, execution branching, and cycle handling.
- LangGraph JS primitives are encapsulated within `@designflow/core`. Higher-level workflow definitions and `@designflow/sdk` consumers interact with generic workflow graphs without direct coupling to LangGraph JS internal schemas.

---

## 3. Repository Structure Rules

DesignFlow is structured as a **Turborepo + Bun** monorepo:

```text
designflow/
├── docs/
│   ├── ENGINEERING_CONSTITUTION.md
│   └── adr/
├── packages/
│   ├── sdk/                # @designflow/sdk
│   ├── core/               # @designflow/core
│   ├── artifacts/          # @designflow/artifacts
│   └── state/              # @designflow/state
├── workflows/
│   ├── workflow-figma/     # @designflow/workflow-figma (example domain workflow)
│   └── workflow-react/     # @designflow/workflow-react (example domain workflow)
├── apps/
│   └── cli/                # designflow CLI package (bin: wf)
├── turbo.json
├── package.json
├── bunfig.toml
├── tsconfig.base.json
└── README.md
```

### V2 Feature Module Layout

Agent Architecture V2 modules own their tests locally. A feature directory is
the architectural boundary, and everything the feature owns — runtime files,
its README, its tests, its fixtures and its helpers — lives inside it:

```text
packages/<package>/src/<feature>/
├── <runtime files>.ts
├── index.ts
├── README.md
└── test/
    ├── <feature>.test.ts
    ├── fixtures/
    └── helpers/
```

- A `*.test.ts` MUST NOT sit directly beside the runtime file it covers.
- A package-level `test/<feature>/` tree that separates a feature from its own
  tests is equally forbidden; only genuinely cross-feature fixtures may live
  in a shared `test/` directory, and each one must justify why.
- Runtime code MUST NEVER import from a `test/` directory.
- `test/` directories are excluded from compiled output (`src/**/test/**` in
  every package `tsconfig.json`) — `.test.ts` naming alone does not protect
  distribution, because a fixture or helper carries no such suffix.

`packages/sdk/src/architecture/test/feature-test-layout.test.ts` enforces all
four rules across the repository. New V2 features (UI Builder, Visual Critic,
and everything after) use this layout from their first commit.

### Repository Hygiene Constraints
- **Package Manager & Runtime:** Bun is the mandatory package manager and execution runtime (`bun install`, `bun run`, `bun test`).
- **Build & Pipeline Orchestration:** Turborepo (`turbo.json`) handles task scheduling, caching, and cross-package build pipelines.
- **No Circular References:** Package dependency graphs MUST be strict DAGs.
- **Single Source of Configuration:** Shared TypeScript configurations extend `tsconfig.base.json`.
- **Isolated Build Outputs:** Every package must output clean types (`dist/*.d.ts`) and ESM bundles (`dist/*.js`).

---

## 4. Package Responsibility Boundaries

### 4.1 `@designflow/sdk`
- **Purpose:** Public API contracts, interface definitions, Zod schema definitions, plugin registration protocols, and base custom error types.
- **Responsibilities:** Defines `ICapability`, `IWorkflow`, `IArtifact`, `IState`, `ExecutionContext`, and schema builders.
- **Constraints:** ZERO internal monorepo package dependencies. Zero heavy third-party runtime dependencies.

### 4.2 `@designflow/core`
- **Purpose:** Workflow orchestration engine, DAG & state graph resolver (using LangGraph JS internally), pipeline execution engine, and lifecycle coordinator.
- **Responsibilities:** Executes workflow plans, schedules capability executions, manages state graph transitions, enforces the 4-phase lifecycle, and routes log/telemetry events.
- **Constraints:** Depends ONLY on `@designflow/sdk`, `@designflow/artifacts`, `@designflow/state`, and internal orchestration helpers.

### 4.3 CLI Package (`apps/cli` / package: `designflow`)
- **Purpose:** User-facing command-line tool package named `designflow` providing the `wf` executable command.
- **Responsibilities:**
  - Exposes subcommands:
    - `wf run`: Executes a designated workflow.
    - `wf status`: Displays current or historical workflow execution status.
    - `wf resume`: Resumes an interrupted or paused workflow execution.
  - Reads user configuration (`designflow.config.ts`), initializes execution context, formats terminal progress UI, and invokes workflow runs via core.
- **Constraints:** Contains zero domain business logic. Serves purely as an interface to load configurations and execute workflows via `@designflow/core`.

### 4.4 Artifacts System (`@designflow/artifacts`)
- **Purpose:** Content-addressed storage, artifact lifecycle management, content hashing, indexing, and candidate diffing.
- **Responsibilities:** Provides `IArtifactStorage` implementations (In-Memory, Local File System, Remote storage adapters), computes generic content-addressable identifiers, manages metadata tags.
- **Constraints:** Depends ONLY on `@designflow/sdk`.

### 4.5 State System (`@designflow/state`)
- **Purpose:** Execution state tracking, state graph snapshots, state machine transitions, and state history recording.
- **Responsibilities:** Manages current and historical state trees, records execution step history, and enforces state immutability.
- **Constraints:** Depends ONLY on `@designflow/sdk` and `@designflow/artifacts`. State system does NOT own or execute rollback logic (rollback execution is orchestrated by core/workflows during lifecycle management).

### 4.6 Workflow Packages (`workflows/workflow-*`)
- **Purpose:** Concrete domain workflows compiling specific inputs into target outputs.
- **Responsibilities:** Implements capabilities, defines workflow DAG/state graph steps, performs domain-specific transformations (e.g., token parsing, code generation).
- **Constraints:** May depend on `@designflow/sdk`, `@designflow/artifacts`, domain-specific third-party libraries, and (when necessary) Vercel AI SDK modules. MUST NOT be imported by Core, State, Artifacts, or SDK.

---

## 5. Dependency Rules

### 5.1 Import Matrix

| Package | Can Import | MUST NEVER Import |
|---|---|---|
| `@designflow/sdk` | External utilities (Zod, etc.) | Core, State, Artifacts, Workflows, CLI, Vercel AI SDK |
| `@designflow/artifacts` | `@designflow/sdk` | Core, State, Workflows, CLI, Vercel AI SDK |
| `@designflow/state` | `@designflow/sdk`, `@designflow/artifacts` | Core, Workflows, CLI, Vercel AI SDK |
| `@designflow/core` | `@designflow/sdk`, `@designflow/artifacts`, `@designflow/state`, LangGraph JS | Workflows, CLI, domain libs, Vercel AI SDK |
| `workflows/*` | `@designflow/sdk`, `@designflow/artifacts`, domain libs, Vercel AI SDK | Core, State, CLI, sibling workflows |
| `apps/cli` (`designflow`) | `@designflow/sdk`, `@designflow/core`, `@designflow/artifacts`, `@designflow/state`, `workflows/*` | Internal private helpers of lower packages |

### 5.2 Dependency Enforcement
- Automated dependency validation scripts (run via `bun run check-deps`) MUST run in Turborepo CI pipelines to reject PRs violating the import matrix.

---

## 6. Coding Standards

### 6.1 TypeScript Rules
- `tsconfig.json` MUST enforce strict settings under Bun:
  - `"strict": true`
  - `"noImplicitAny": true`
  - `"exactOptionalPropertyTypes": true`
  - `"noUncheckedIndexedAccess": true`
  - `"noImplicitReturns": true`
  - `"noFallthroughCasesInSwitch": true`
- **Explicit Types:** All exported function signatures, public methods, and capability interfaces MUST have explicit return types.
- **No `any` Policy:** The `any` type is strictly forbidden. Use `unknown` paired with Zod schema parsing for untyped inputs.

### 6.2 Zod Schema Usage
- All data boundaries—including capability inputs/outputs, user configuration files, runtime flags, state payloads, and artifact manifests—MUST be defined using Zod schemas.
- TypeScript types MUST be derived directly from Zod schemas:
  ```ts
  export const CapabilityInputSchema = z.object({
    id: z.string().uuid(),
    sourcePath: z.string(),
  });
  export type CapabilityInput = z.infer<typeof CapabilityInputSchema>;
  ```

### 6.3 Error Handling
- All thrown errors MUST inherit from the base `DesignFlowError` class provided by `@designflow/sdk`.
- Errors must include structured contextual metadata and standardized error codes:
  ```ts
  export class ValidationError extends DesignFlowError {
    constructor(message: string, context: Record<string, unknown>) {
      super(message, 'ERR_VALIDATION_FAILED', context);
    }
  }
  ```
- Silent exception swallowing (`catch (e) {}`) and untyped raw string throwing (`throw 'error'`) are forbidden.

### 6.4 Logging
- Direct calls to `console.log`, `console.error`, or `console.warn` inside `@designflow/core`, `@designflow/sdk`, `@designflow/artifacts`, and `@designflow/state` are STRICTLY PROHIBITED.
- Core packages must emit structured log events through the `Logger` context provided by `@designflow/sdk`.
- The CLI (`wf`) formatted log subscriber is responsible for rendering logs to stdout/stderr.

### 6.5 Testing Philosophy
- **Runner:** Bun's native test runner (`bun test`) is used across the monorepo.
- **Unit Testing:** 100% schema validation test coverage for all Zod definitions and core pure functions.
- **Contract Testing:** All capabilities must pass standard contract verification suites testing input validation, execution error handling, and artifact emission.
- **Integration Testing:** End-to-end integration tests verifying the full Plan → Execute → Validate → Apply lifecycle for representative workflows using in-memory artifact storage backends.

---

## 7. AI Development Rules

### 7.1 AI-Generated Code Review
- **Boundary Verification:** Code written or generated by AI must be audited to ensure strict compliance with package boundaries, import rules, Vercel AI SDK isolation, and BYOK credentials handling.
- **No Over-Engineering:** AI implementations must focus solely on fulfilling explicitly declared Zod schemas and interface contracts. Unrequested utility methods, speculative helpers, or unnecessary abstractions must be rejected.

### 7.2 Recording Architectural Decisions
- Any change to package interfaces, core lifecycle steps, artifact hashing strategies, or Zod schemas requires an Architectural Decision Record (ADR).
- ADRs are stored in `docs/adr/YYYYMMDD-title.md` following the standard Context / Decision / Consequences structure.

### 7.3 Merge Validation Checklist
Before merging any pull request (human or AI generated), Turborepo CI must pass:
1. `bun run lint` (Zero linter warnings/errors).
2. `bun run typecheck` (Zero TypeScript compiler errors).
3. `bun test` (100% test pass rate across unit, contract, and integration suites).
4. `bun run check-deps` (Zero import boundary violations).

---

## 8. Future Extensibility Rules

### 8.1 Adding New Capabilities
To introduce a new capability:
1. Define the input/output Zod schemas in a domain package or plugin.
2. Implement the `ICapability<TInput, TOutput>` interface from `@designflow/sdk`.
3. Provide unit and contract tests verifying execution behavior using `bun test`.
4. Export and register the capability within a workflow manifest.

### 8.2 Adding New Workflows
To introduce a new workflow:
1. Create a new package under `workflows/workflow-<name>`.
2. Define the workflow graph using `@designflow/sdk` workflow builders.
3. Compose compiler passes using existing or custom registered capabilities.
4. Export the workflow entry point for CLI (`wf run`) or programmatic execution.

### 8.3 Adding New Storage Backends
To add a custom artifact storage backend (e.g., Redis, S3, GCS):
1. Create an implementation of the `IArtifactStorage` interface from `@designflow/artifacts`.
2. Ensure generic content-addressable identifier generation and stream reading/writing comply with SDK specifications.
3. Execute and pass the standard `@designflow/artifacts` storage test suite against the new backend implementation.

---

*This constitution represents the foundational architectural law of DesignFlow. All pull requests, code additions, and architectural modifications MUST comply with these principles.*
