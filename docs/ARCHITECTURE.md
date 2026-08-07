# DesignFlow architecture

DesignFlow is a deterministic, capability-driven workflow engine. This
document records the repository map and the ownership rules used to keep
domain contracts independent from concrete runtimes.

## Repository map

```text
apps/
├── cli/                         legacy `wf` CLI
├── designflow-cli/              current `designflow` CLI and composition root
├── designflow-api/              HTTP application host
├── designflow-demo/             terminal demonstration application
└── designflow-web/              browser UI

packages/
├── sdk/                         public contracts, ports, schemas, errors
├── core/                        compilation, DAG execution, policy, lifecycle
│   ├── application/execution/   execution use case and compatibility boundary
│   ├── runtime/                 capability runtime
│   ├── planning/                incremental planning
│   ├── approval/                approval state managers
│   └── composition/             workflow composition wiring
├── artifacts/                   artifact storage and content identity
├── state/                       execution state contracts and records
├── storage-file/                file-backed persistence adapters
├── storage-sqlite/              SQLite persistence adapters
├── policy/ (planned seam)        currently owned by core/policy
├── agents/                      typed agent invocation and catalog
├── models/                      model profiles and provider registry
├── model-provider-openrouter/   OpenRouter adapter
├── mcp/                         MCP protocol runtime
├── capabilities/
│   ├── figma-mcp/               Figma source and MCP adapter capability
│   ├── implementation/          project inspection and safe application
│   └── test-artifact/            test-only capability package
├── tools/                       typed analysis and inspection tools
├── workers/                     product-facing worker catalog
└── product/                     application-facing orchestration and views

workflows/
└── workflow-*/                 independently loadable workflow packages

test-fixtures/                   source-controlled acceptance projects
```

The current repository intentionally keeps `policy` inside `core` and the
product services together. Splitting those into new packages would create
public API and dependency churn without improving the present runtime seam.
They are documented as seams to preserve, not as invitations to add a generic
shared package.

## Dependency direction

```text
Applications / CLI / Web
          ↓
Composition roots and adapters
          ↓
Product use cases and workflows
          ↓
Core orchestration
          ↓
SDK contracts, ports, and boundary schemas
          ↑
Infrastructure implementations
```

Allowed dependencies point toward contracts. The following are forbidden:

* SDK and core importing CLI, filesystem, HTTP, OpenRouter, Figma Desktop, or
  browser implementations.
* Domain/workflow definitions importing application composition roots.
* Production code importing `test-fixtures/`, `test/`, or `*.test-support.ts`.
* Consumers importing package internals when the package root export exists.
* A provider adapter being used directly where an SDK port is available.

An adapter may depend on its port and the external technology. A composition
root may construct adapters and pass them inward. A workflow may depend on
typed capabilities and schemas, but it must not construct a concrete model,
MCP, filesystem, or Figma runtime.

## Package ownership table

| Package | Owns | Must not own | Public entry point |
| --- | --- | --- | --- |
| `sdk` | contracts, ports, schemas, errors | execution, I/O, provider clients | `@designflow/sdk` |
| `core` | compilation, DAG scheduling, lifecycle, policy decisions | CLI presentation, external transports | `@designflow/core` |
| `artifacts` | artifact identity and stores | workflow-specific business rules | `@designflow/artifacts` |
| `state` | state records and state-store contracts | CLI persistence policy | `@designflow/state` |
| `storage-file` | file-backed adapters | domain orchestration | `@designflow/storage-file` |
| `storage-sqlite` | SQLite adapters | browser/UI code | `@designflow/storage-sqlite` |
| `agents` | agent contracts, catalogs, invocation runtime | provider-specific HTTP | `@designflow/agents` |
| `models` | profiles and registry | direct model transport | `@designflow/models` |
| `model-provider-openrouter` | OpenRouter transport adapter | workflow policy | `@designflow/model-provider-openrouter` |
| `mcp` | MCP protocol and transport | Figma domain mapping | `@designflow/mcp` |
| `capability-figma-mcp` | Figma mapping and MCP capability | generic MCP transport ownership | `@designflow/capability-figma-mcp` |
| `capability-implementation` | bounded project inspection and safe apply | CLI command parsing | `@designflow/capability-implementation` |
| `tools` | typed analysis tools | orchestration and persistence | `@designflow/tools` |
| `workers` | worker metadata and catalog | engine construction | `@designflow/workers` |
| `product` | application use cases and presentation models | CLI-specific I/O and engine construction | `@designflow/product` |
| workflow packages | workflow definitions and capability composition | host-specific runtime construction | `@designflow/workflow-*` |
| applications | commands, screens, composition | reusable domain contracts | app package root |

## Public API conventions

Every package exposes its intentional API through `src/index.ts` and its
package-root `exports` map. Concrete internals are not re-exported merely
because they exist. New consumers should use:

```ts
import { ExecutionService } from "@designflow/core";
import { designToCodeWorkflow } from "@designflow/workflow-design-to-code";
```

The old `@designflow/core` `service` directory remains a compatibility entry
point, but new code should import the public package root. Compatibility
aliases must be labeled and retained until a separately authorized breaking
change. No package currently exposes wildcard internal exports.

## File-placement rules

* `domain/`: pure rules and models; no concrete I/O.
* `application/`: use cases and orchestration.
* `ports/`: interfaces required by inward-facing code.
* `infrastructure/`: concrete persistence, transport, or runtime code.
* `adapters/`: translation between external and internal contracts.
* `schemas/`: boundary schemas without a more specific owner.
* `internal/`: non-public implementation details.
* `test/` and `test-fixtures/`: test support and stable acceptance projects.

Feature folders are preferred over global `utils`, `helpers`, `common`, or
`shared` folders. A file should have one obvious responsibility. Keep stable
public names unless a move creates a real ownership improvement; when moving,
use a compatibility re-export.

## Adding a capability

1. Define its typed input/output contract and boundary schemas in SDK or the
   capability package.
2. Keep pure mapping and validation in the capability package.
3. Put external calls behind an SDK port.
4. Put concrete transport code in an adapter or infrastructure package.
5. Register it through the capability registry and add success/failure-path
   tests.

## Adding a workflow

Create a workflow package under `workflows/` with a root `src/index.ts`, a
manifest, workflow definition, capability composition, boundary schemas, and
package-local tests. The workflow may consume ports and typed capabilities;
the application composition root supplies concrete runtimes.

## Adding an agent

Add the invocation contract first, then a catalog entry with a deterministic
strategy. Model-backed behavior must be selected explicitly by a composition
root and must remain behind the agent/model ports. Add schema rejection,
provenance, and per-agent model-independence tests.

## Adding an infrastructure adapter

Implement an existing port in the infrastructure or adapter package. Validate
external data at the boundary, preserve fail-closed behavior, and keep the
technology name in the concrete class/file name. Wire it only in a composition
root; do not make domain packages discover it through globals or environment
guessing.

## Adding a test fixture

Use an OS temporary directory for disposable projects. Put stable,
source-controlled acceptance projects under `test-fixtures/`. Do not import a
fixture from production code. Generated copies and preview output belong under
`test-fixtures/.generated/` or the OS temporary directory and are ignored.

## Audit notes and intentional debt

The audit found the following structural problems and addressed the lowest-risk
ones in this refactor:

* execution application logic lived under the vague `core/src/service/` name;
  it now lives under `core/src/application/execution/` with a compatibility
  re-export;
* tracked Stage 4/7 preview projects lived under the CLI's production tree;
  they now live under `test-fixtures/`;
* MCP fake-server code and Figma/workflow test support lived under production
  `src/` trees; they now live under package-level `test/` directories;
* package documentation and ownership rules were incomplete;
  package READMEs and this document provide the missing contract;
* `core` still groups several cohesive domain features and `product` still
  contains several application services. They remain intentionally grouped
  because their public exports and existing tests establish stable seams; a
  later split should be a separately validated change.

No persisted artifact schema, CLI command name, approval gate, security check,
provenance rule, or package version is changed by this reorganization.

## Visual correction (Beta)

The canonical Design Engineer journey may offer a bounded visual-correction
continuation after a valid visual-validation result with actionable findings.
The host owns eligibility, artifact selection, fingerprints, approval binding,
snapshot/apply/validate/rollback, visual recapture, comparison, lineage, and
iteration limits. The Visual Correction Specialist only interprets findings
and prepares a typed proposal.

The continuation is off by default. One explicit beta opt-in authorizes at most
one correction iteration, and every exact proposal requires a separate,
hash-bound approval. Internal workflow ids, correction JSON, artifact ids, and
trusted hashes are not user-facing. Pending or completed child executions are
visible through the parent artifact and trace inspection commands.

Live-provider, real-Figma, real-browser, and real-project apply/rollback
evidence remain MVP-4 gates.
