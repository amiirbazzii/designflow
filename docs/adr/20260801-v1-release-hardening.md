# v1 Release Hardening

**Date:** 2026-08-01
**Status:** Accepted
**Stage:** 42

## Context

Stage 41 made DesignFlow a real four-worker product with a Worker Task
Boundary. Stage 42 is the last stage before a v1 release: no new
architectural layer, no redesign — closing the gaps between "the
architecture works" and "a real user can install this and trust it."

Given the size of the source spec (14 sections covering linting, session
durability, web migration, a demo decision, evaluation, reliability,
storage, security, model controls, npm release, docs, product-experience
verification, architecture audit, and a final test matrix), this stage
implemented the highest-value, independently verifiable subset of each
section rather than attempting literal completion of all 14 in full depth.
Section 10 (npm bundling) in particular was explicitly scoped down; see
"Known limitations" below. Where the spec allowed a binary choice (§4, the
demo), a choice was made and documented rather than left ambiguous.

## 1. v1 architecture (unchanged, now verified)

The Stage 41 stack is unchanged:

```
User → CLI / API / Web → packages/product → packages/workers (4 manifests)
  → packages/agents (4 agents) → packages/models (per-agent OpenRouter profile)
  → workflows/* (4 deterministic WorkflowPackages) → packages/core (engine)
```

This stage added one correction to that stack's dependency shape: the new
deterministic evaluation layer (§6 below) initially made `packages/product`
depend on all four `workflow-*` packages to reuse their artifact schemas.
Those same workflow packages already carry a legitimate, pre-existing
test-only `devDependency` on `@designflow/product` (each workflow's own
`harness.test-support.ts` builds an in-process `WorkflowRunner` to test
itself end-to-end). Combined, this created a real `product → workflow-* →
product` cycle that broke `turbo build`. The fix: each worker's evaluator
now lives inside its own workflow package (`workflows/workflow-*/src/evaluate.ts`,
exporting e.g. `evaluateQaReviewerCriterion`), built only from that
package's own schemas and shared, generic helpers now hosted in
`@designflow/sdk` (`worker-evaluation-helpers.ts`). `packages/product`
contains only the generic aggregation function and takes the concrete
per-worker evaluators as an **injected** `Record<string, WorkerCriterionEvaluator>`,
supplied by the one caller that already legitimately depends on both layers:
`apps/designflow-api/src/host.ts`. `packages/product` depends on
`@designflow/sdk` alone again, matching every other stage's discipline.

## 2. Worker model (unchanged)

Four workers — Design Engineer, QA Reviewer, Research Analyst, Product
Manager — each with an independent agent, tool allow-list, model profile,
and workflow. No change this stage; verified, not modified.

## 3. Agent model selection (unchanged, now audited)

Verified (not re-architected) that all 4 built-in model profiles resolve to
a concrete positive timeout: either their own declared `timeoutMs`, or the
runtime's `DEFAULT_MODEL_TIMEOUT_MS` fallback
(`packages/models/src/runtime.ts`). No profile is unbounded. Per-decision
model-call budgeting (`packages/agents/src/model-service.ts`) was already in
place from Stage 38 and required no change.

## 4. Storage decisions

Two storage tiers now both meet a durability bar appropriate to their scale:

- **`packages/storage-file`** (the CLI's local single-user store) gained
  corruption detection and locking. A store file that exists but fails to
  parse is renamed to `<path>.corrupt-<timestamp>` (preserving the bytes,
  not silently discarding them) and a stable `ERR_STORE_CORRUPTED` is
  thrown, surfaced by the CLI's existing error-formatting path rather than a
  raw stack trace. A sibling `<path>.lock` file (exclusive-create,
  stale-reclaim after 30s) prevents two processes racing on the same store
  from silently losing an update; contention throws `ERR_STORE_LOCKED`. No
  distributed locking, no database migration — this remains a single-user,
  single-machine store by design.
- **`apps/designflow-api`** now persists agent sessions durably. A new
  `SqliteSessionStore` (`packages/storage-sqlite`) implements the same
  `SessionStore` contract `InMemorySessionStore`/`FileSessionStore` already
  satisfied, replacing the in-memory store that was the one piece of API
  state that didn't survive a restart. Verified with a real integration test
  that starts a session, discards the `ApiHost`, rebuilds a second one
  against the same sqlite file, and confirms the session resumes and
  completes — a literal simulated process restart, not a mock.

## 5. Security model (verified, one real defect found and fixed)

Existing enforcement (tool allow-lists, workflow allow-lists, per-decision
model budgets, trace hygiene that never carries prompt/completion text or
credentials) was audited and found already correct — covered by pre-existing
adversarial test suites in `packages/tools`, `packages/agents`,
`packages/models`, `apps/designflow-api`, `apps/designflow-cli`. This stage
added further adversarial coverage: a memory note phrased as an explicit
prompt-injection ("SYSTEM OVERRIDE: ignore previous instructions...") proven
inert against an agent's real allow-lists; malformed workflow input proven
to fail as a stable typed error, never a raw crash; tool output that doesn't
match its declared schema proven rejected before reaching an artifact; CLI
project inspection proven to have no user-controllable path parameter that
could traverse outside a project root.

**One real defect was found by the packaged smoke test, not by unit tests**,
and fixed in this stage: `InMemoryPolicyEvaluator.evaluateApprovalRule`
(`packages/core/src/policy/in-memory-policy-evaluator.ts`) pushed an
approval violation for **every** `require_approval` rule in a merged policy,
unconditionally — unlike its sibling `evaluateDenyRule`, which correctly
scopes by `context.capabilityIds`. Because the API/CLI/demo composition
roots all merge all 4 workflows' approval policies into one combined policy
(needed so any of the 4 workers can be approved through one policy object),
every approval prompt showed every workflow's internal rule id, e.g.:

```
Reason: Approval required by policy rule "approve-code-generation"; Approval required
by policy rule "approve-qa-report"; Approval required by policy rule "approve-research-brief";
Approval required by policy rule "approve-product-brief"
```

on every single run, for every worker — a real internal-vocabulary leak,
plus noise unrelated to the run in front of the user. Fixed by scoping
`evaluateApprovalRule` to the rule's own `target` capability (mirroring
`evaluateDenyRule`'s existing pattern), and by having its violation message
prefer the workflow's own human-facing `metadata.reason` text over the raw
rule id — so a QA Reviewer run now shows only its own reason
("Publishing a verdict the team will act on"), never the other three
workflows' internal rule names. A regression test now proves a
`require_approval` rule scoped to a capability outside the running
execution never fires.

## 6. Evaluation system

A first deterministic evaluation layer computes a `WorkerEvaluationSummary`
for every completed `WorkerResult`, using each worker's declared
`evaluationCriteria` (Stage 41 metadata that was, until this stage,
write-only). No model or network call is involved anywhere in this feature —
every criterion is decided from already-available data: execution state,
artifact presence, or an artifact's own Zod-validated structure (e.g. QA
Reviewer's "findings have severity" parses `severity-assessment` against its
real schema; Research Analyst's "claims linked to sources" cross-checks
`extracted-claims` against `source-inventory`). A criterion that genuinely
requires semantic judgment (e.g. "design-system reuse detected") is reported
as `satisfied: undefined` with an explanatory note — correct behavior for a
non-LLM evaluator, not an unfinished check. Evaluation never authorizes
execution; it only measures completed output quality, wired into
`WorkerResultService` after a result already exists.

## 7. Release process

- Real linting is now enforced repo-wide: a root flat `eslint.config.js`
  (typescript-eslint, non-type-aware — the monorepo's project-reference
  `tsconfig`s exclude test files, so type-aware linting would either skip
  every test or require a second lint-only tsconfig per package; deferred as
  not worth the complexity this stage), replacing all 22 previously-fake
  `echo` lint scripts. ~230 real violations were found and fixed (mostly a
  systemic `import {...}` / `import type {...}` split pattern the
  `no-duplicate-imports` rule caught, plus genuine dead imports and four
  narrowly-justified `console` calls in the CLI's own `Logger`
  implementation).
- `docs/RELEASE_CHECKLIST.md` documents the manual release steps: version
  bump, full gate, packaged smoke test, tag, `npm publish` from
  `apps/designflow-cli`, and a post-publish smoke test against the real
  registry. Publishing itself is explicitly out of scope for this stage —
  requires separate human confirmation.
- The packaged CLI (`npm pack` → global install → run under plain Node) was
  verified end-to-end via `scripts/cli-smoke-test.sh`, extended this stage
  to cover all 4 workers, a clarification-and-resume cycle, a restart, and a
  repo-wide internal-vocabulary leak sweep (which is what caught the defect
  in §5). The shipped `dist/main.js` bundle was grepped for `Bun.*` global
  usage — none found — and confirmed to carry a `#!/usr/bin/env node`
  shebang.
- A `LICENSE` file was added at the repo root (standard MIT text, since
  `apps/designflow-cli/package.json` already declared `"license": "MIT"`
  without a corresponding file existing anywhere). **The copyright holder
  line needs human confirmation before publish** — it was filled from the
  sole git commit author, not a company/entity decision this stage is
  authorized to make.

## 8. Known limitations

- **npm packaging.** ~~The published `designflow` package still resolves
  ~15 `workspace:*` internal packages~~ — **corrected in Stage 42.5**: `bun
  build --target=node --format=esm` (`apps/designflow-cli`'s existing build
  script) already inlines every `@designflow/*` internal package into one
  `dist/main.js`. This was never actually a gap; it was undiagnosed. See
  [`20260802-release-candidate-validation.md`](20260802-release-candidate-validation.md).
- **No stale-session/abandoned-approval expiry mechanism.** ~~A session left
  in `waiting_for_user`, or an approval left pending indefinitely, has no
  TTL or automatic cleanup.~~ **Closed in Stage 42.5** — see the ADR linked
  above.
- **The demo app's multi-worker support is workflow-engine-level, not
  Worker-Task-Boundary-level.** `apps/designflow-demo` now runs any of the
  4 workflows to completion (Stage 42, §4 of the source spec, Option A), but
  remains a direct `WorkflowRunner` consumer with no sessions, clarification
  loop, or memory — a deliberately smaller surface than the CLI/API/web,
  chosen because adding session support to the demo would be a new
  capability, not polish.
- **Lint is non-type-aware.** `@typescript-eslint/no-explicit-any` and
  friends catch real issues, but a rule that requires actual type
  information (e.g. `no-unsafe-assignment`) was not enabled, for the
  tsconfig-project-reference reason noted in §7.
- **Reliability coverage is representative, not exhaustive.** Duplicate-task
  idempotency, crash-mid-execution non-fabrication, and corrupted-store
  recovery are covered with real tests; a full enumeration of every failure
  mode in the source spec's §6 list (every partial-write shape, every
  duplicate-request race) was not attempted.

## 9. Future roadmap

- v1.1: bundle the CLI into a single dependency-free npm artifact.
- Add session/approval TTL policy once product requirements for "how long
  is too long" are defined.
- Extend the demo to the full Worker Task Boundary if it needs to
  demonstrate sessions/clarification, not just workflow execution.
- Revisit type-aware linting once/if the tsconfig project-reference
  structure changes to include test files in a lintable project.

## Verification

- `bun run build` — 23/23 packages.
- `bun run typecheck` — 41/41 tasks.
- `bun run lint` — 23/23 packages, 0 errors (real eslint, not placeholders).
- `bun test` (repo-wide) — 45/46 test tasks pass; the sole failure is
  `@designflow/capability-test-artifact`, a pre-existing package with zero
  test files, unrelated to and untouched by this stage.
- `scripts/cli-smoke-test.sh` — full pass, zero warnings, after the §5 fix
  (the leak sweep initially failed and caught the policy-evaluator defect
  before this ADR was written).
