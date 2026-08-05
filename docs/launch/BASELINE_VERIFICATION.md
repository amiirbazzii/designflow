# L0 Baseline Verification — DesignFlow

- **Audit date:** 2026-08-05
- **Commit:** `48480fa562a045e9cf1d05e7069a8a560575b754` (branch `main`)
- **Auditor:** Stage L0 baseline-freeze audit (read-only outside `docs/launch/`)

## Working-tree status before this task

`git status --short` at audit start:

```
 M .claude-flow/daemon-state.json
?? .claude-flow/daemon.pid
?? docs/DesignFlow-Current-Architecture-and-Product-Baseline.md
```

The `.claude-flow/` entries are local tooling state and are excluded from this
task. The untracked architecture-baseline doc pre-existed this audit.

## Verified package version

`apps/designflow-cli/package.json`: `"name": "designflow-ai"`,
`"version": "0.1.1"`, bin `designflow` → `dist/main.js`. **Unchanged by this
task.**

## Workspace / package inventory

Root `package.json` (`designflow-monorepo`, `packageManager: bun@1.3.14`,
Turborepo) declares workspaces `apps/*`, `packages/*`,
`packages/capabilities/*`, `workflows/*`. 26 workspace `package.json` files:

- **apps (5):** `cli` (`@designflow/cli-legacy`), `designflow-api`,
  `designflow-cli` (**`designflow-ai`**, the published package),
  `designflow-demo`, `designflow-web`
- **packages (14):** `agents`, `artifacts`, `core`, `mcp`,
  `model-provider-openrouter`, `models`, `product`, `sdk`, `state`,
  `storage-file`, `storage-sqlite`, `tools`, `workers`, plus the
  `capabilities` parent dir
- **packages/capabilities (3):** `figma-mcp`, `implementation`,
  `test-artifact`
- **workflows (5):** `workflow-design-to-code`, `workflow-product-brief`,
  `workflow-qa-review`, `workflow-research-analysis`, `workflow-test`

## Baseline statement verification

| # | Expected statement | Classification | Evidence |
|---|---|---|---|
| 1 | Baseline commit ≈ `48480fa` | CONFIRMED | `git rev-parse HEAD` = `48480fa562a045e9cf1d05e7069a8a560575b754` |
| 2 | Package `designflow-ai` | CONFIRMED | `apps/designflow-cli/package.json` `name` |
| 3 | Version `0.1.1` | CONFIRMED | `apps/designflow-cli/package.json` `version` |
| 4 | TypeScript + Bun + Turborepo monorepo | CONFIRMED | root `package.json` (`bun@1.3.14`, `turbo`, `typescript`), `turbo` scripts |
| 5 | CLI-first, local-first product | CONFIRMED | published bin is the CLI (`designflow`); persistence is local file/SQLite (`packages/storage-file/src/store.ts`, `packages/storage-sqlite/src/*`); `docs/STAGE_7_PRODUCTION_READINESS.md` documents local state under `~/.designflow` |
| 6 | OpenRouter is the current model provider | CONFIRMED | `packages/model-provider-openrouter/src/provider.ts`; live test `apps/designflow-cli/src/live-openrouter.test.ts` |
| 7 | Routing agents vs specialized agents use separate registries and runtimes | CONFIRMED | `packages/agents/src/index.ts` — `createAgentRegistry` (line 253) vs `createSpecializedAgentRegistry` (line 302); `packages/agents/src/runtime.ts` (`AgentRuntime`) vs `packages/agents/src/invocation-runtime.ts` (`AgentInvocationRuntime`); wired separately in `apps/designflow-cli/src/services/cli-runner.ts` (~line 585) |
| 8 | Agents decide/interpret/propose; deterministic engine + capabilities own execution, approvals, writes, shell, validation, rollback, iteration limits | CONFIRMED (by code structure and tests; full behavioral re-proof out of L0 scope) | side effects live in capabilities (`packages/capabilities/implementation`, `packages/capabilities/figma-mcp`); approvals via `ExecutionService` `approvalManager`/`policyEvaluator` in `cli-runner.ts`; agents packages expose decision/strategy interfaces only (`packages/agents/src/decision-prompt.ts`, `catalog/*`); `docs/STAGE_7_PRODUCTION_READINESS.md` "Git-aware writes" |
| 9 | Complete Design Engineer implementation + feedback loop remain experimental | CONFIRMED | `registerExperimentalDesignToCodeWorkflows` in `cli-runner.ts:155`; gating via `settings.experimental.designEngineerFigmaMcp` (`cli-runner.ts` ~line 510, `figma-mcp-config.test.ts` "the experimental flag > is off when nothing is configured"); `experimentalImplementationEnabled` flag (`cli-runner.ts:323`, 963) |
| 10 | Public default `design-to-code` is artifacts-only and does not write to the project | CONFIRMED | default `designToCodeWorkflowPackage` output flows through `artifactStore`/`writeArtifact` (`workflows/workflow-design-to-code/src/artifact-io.ts`); project writes exist only in the experimental implementation path (`packages/capabilities/implementation`), gated per #9 |
| 11 | build: 26/26 packages | CONFIRMED | `bunx turbo build --force`: "Tasks: 26 successful, 26 total, Cached: 0" |
| 12 | typecheck: 44/44 tasks | CONFIRMED | `bunx turbo typecheck --force`: "Tasks: 44 successful, 44 total, Cached: 0" |
| 13 | lint: 26/26 packages | CONFIRMED | `bunx turbo lint --force`: "Tasks: 26 successful, 26 total, Cached: 0" |
| 14 | tests: 2,248 passed, 1 skipped, 0 failed | CONFIRMED | `bunx turbo test --force` (52/52 tasks); per-package summaries sum to 2,248 pass / 1 skip / 0 fail; the single skip is `apps/designflow-cli/src/live-openrouter.test.ts` "a live OpenRouter call > the configured profile answers a small, bounded, non-sensitive request" (requires `OPENROUTER_API_KEY`) |

## Model-provider wiring

`packages/model-provider-openrouter` (provider) → `packages/models` (runtime,
structured outputs; recent commit `086b0fb` "support OpenRouter flat
structured outputs") → agents' model strategies in
`packages/agents/src/model-service.ts` / `model-structured-output.ts`, wired
in `cli-runner.ts` only when model mode is requested (`modelsRequired:
modelModeRequested`).

## Persistence implementations

- `packages/storage-file` — file-backed store (`src/store.ts`, adapters,
  feedback-loop parent store, state-health checks). Single JSON store; the
  screenshot-payload growth risk targeted by roadmap stage L2 lives here.
- `packages/storage-sqlite` — SQLite-backed `approval-manager`,
  `artifact-store`, `event-store`, `execution-repository`, `session-store`.

## Workflow registrations

Public (always registered in `cli-runner.ts` ~line 608):
`workflow-design-to-code`, `workflow-qa-review`,
`workflow-research-analysis`, `workflow-product-brief` (plus
`workflow-test` used by the legacy CLI). Experimental (config-gated):
Figma-MCP design-to-code path, `design-to-code-implementation`, and
`design-to-code-feedback-loop` (`FEEDBACK_LOOP_WORKFLOW_ID`,
`cli-runner.ts:135`) via `registerExperimentalDesignToCodeWorkflows`.

## Agent registrations

Catalog (`packages/agents/src/catalog/`): `product-manager-agent`,
`qa-reviewer-agent`, `research-analyst-agent`, `design-engineer-agent`,
`design-engineer-coordinator` (routing registry) and specialized agents
`figma-specification-agent`, `implementation-agent`, plus visual
validation/correction strategies (specialized registry).

## Release scripts

- `apps/designflow-cli/package.json`: `build` (bun bundle), `prepublishOnly:
  bun run build`, `smoke: bash ../../scripts/cli-smoke-test.sh`.
- `scripts/cli-smoke-test.sh` (only file in `scripts/`).
- `docs/RELEASE_CHECKLIST.md`, `docs/RELEASE_NOTES.md`,
  `docs/adr/20260802-release-candidate-validation.md`.

## Documented release blockers (pre-existing)

`docs/STAGE_7_PRODUCTION_READINESS.md`: "hardening in progress; release
candidate not ready" — a production release requires an accessible real Figma
design/MCP server and a live model-provider credential; "Synthetic MCP
fixtures are not evidence of a real Figma integration." Chromium is an
optional, separately installed runtime dependency.

## Exact commands executed and results

All run at `48480fa`, cache bypassed (`--force`; every summary reported
`Cached: 0`):

| Command | Result |
|---|---|
| `bunx turbo build --force` | 26 successful / 26 total, 0 cached, 1.914s |
| `bunx turbo typecheck --force` | 44 successful / 44 total, 0 cached, 6.801s |
| `bunx turbo lint --force` | 26 successful / 26 total, 0 cached, 6.186s |
| `bunx turbo test --force` | 52 successful / 52 total, 0 cached; aggregate **2,248 pass / 1 skip / 0 fail** (single skip: live OpenRouter test, credential-gated) |

## Discrepancies from the expected baseline

None. All 14 expected baseline statements verified as CONFIRMED at
`48480fa`.

## Unresolved uncertainties

1. Statement #8 (agent non-authority) is confirmed structurally and by the
   existing test suites; an adversarial behavioral re-proof is deferred to L1
   (gate G-05) and L5 (gate G-06).
2. The six L1 safety gaps named in the roadmap were provided as confirmed by
   the program brief; they were not independently re-reproduced during L0 and
   must be reproduced at the start of L1.
3. The single skipped test is credential-gated, not quarantined; live
   coverage is deferred to L5 (gate G-08).
4. `.claude-flow/` local state was already dirty before the audit and is
   outside task scope.

## Modification statement

No production code, dependencies, lockfiles, configuration, or package
versions were modified. The only files created are
`docs/launch/BASELINE_VERIFICATION.md`, `docs/launch/LAUNCH_ROADMAP.md`, and
`docs/launch/LAUNCH_GATES.md`. No Git commits were created or amended.
