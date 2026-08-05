# DesignFlow Launch Roadmap

Canonical roadmap for the public launch-readiness program of `designflow-ai`.
Stages are strictly ordered: **a stage cannot begin until the previous stage
has been accepted** by the program owner with recorded evidence.

Baseline: commit `48480fa`, package `designflow-ai@0.1.1`
(see `docs/launch/BASELINE_VERIFICATION.md`).

---

## L0 — Baseline Freeze

**Objective.** Verify the repository against the expected baseline and
establish canonical launch gates.

**In scope.**
- Record commit, working-tree state, package version, workspace inventory,
  workflow/agent registrations, model-provider wiring, persistence
  implementations, release scripts, and documented release blockers.
- Verify each expected baseline statement against code (CONFIRMED / CHANGED /
  NOT VERIFIABLE).
- Run full build, typecheck, lint, and tests with cache bypass.
- Create `BASELINE_VERIFICATION.md`, `LAUNCH_ROADMAP.md`, `LAUNCH_GATES.md`.

**Out of scope.** Any production-code change, dependency change, refactor,
feature work, version bump, or fix of discovered discrepancies.

**Dependencies.** None (program start).

**Entry criteria.** Repository at an identified commit; validation toolchain
available.

**Completion criteria.** All three launch documents exist; every baseline
statement classified with file/symbol evidence; validation commands executed
with recorded exact results; discrepancies logged, not fixed.

**Evidence.** `docs/launch/BASELINE_VERIFICATION.md` with command transcripts.

---

## L1 — Safety and Correctness Hardening

**Objective.** Close confirmed safety and correctness gaps in the
deterministic engine, approval path, and MCP integration.

**In scope.**
- Workflow-ID-only approval targets that silently match nothing.
- Parsed but unenforced resource-limit policy rules.
- Missing SIGINT-to-AbortSignal propagation.
- Unrestricted baseline environment inheritance by stdio MCP child processes.
- Missing stdio MCP negotiated-protocol verification.
- Duplicated visual-validation contracts and the unsafe cast joining them.

**Out of scope.** New features, productization of the Design Engineer path,
release packaging work, documentation alignment.

**Dependencies.** L0 accepted.

**Entry criteria.** L0 accepted; each gap reproduced or evidenced at a
specific file/symbol.

**Completion criteria.** Each listed gap fixed with regression tests, or
formally waived with rationale recorded in the gate log; full validation suite
green.

**Evidence.** Diffs, new tests, green full-suite run.

---

## L2 — Release Reliability

**Objective.** Make the released artifact and release process trustworthy.

**In scope.**
- Incomplete published-package dependency metadata.
- Stale or incomplete TypeScript project references.
- Installed-package and `npm pack` correctness.
- Screenshot payload growth inside the single JSON store
  (`packages/storage-file`).
- Release checks affected by stale Turborepo cache (force/cache-bypass policy).
- Other directly evidenced release blockers.

**Out of scope.** Architecture changes beyond what the listed items require;
persistence backend replacement.

**Dependencies.** L1 accepted.

**Entry criteria.** L1 accepted; pack/install reproduction environment
available.

**Completion criteria.** `npm pack` artifact installs and runs in isolation;
metadata and project references verified; storage-growth risk mitigated or
bounded with documented limits; release checks defined with cache bypass.

**Evidence.** Pack/install transcripts, artifact inspection, storage tests.

---

## L3 — Flagship Productization

**Objective.** Turn the complete Design Engineer path (experimental
implementation + feedback loop) into a coherent, supported product
experience.

**In scope.** Product-experience work on the experimental path while
preserving, unchanged in authority:
- explicit approvals;
- exact proposal/hash binding;
- project snapshots;
- atomic application;
- validation;
- rollback;
- bounded correction iterations;
- deterministic ownership of side effects (engine and capabilities, never
  agents, own filesystem writes, shell commands, approvals, rollback, and
  iteration limits).

**Out of scope.** Post-launch architecture-track items; weakening any safety
boundary; implementing this stage during L0–L2.

**Dependencies.** L2 accepted.

**Entry criteria.** L2 accepted; experimental path passing its acceptance
suites.

**Completion criteria.** Design Engineer path is a supported (non-experimental
or explicitly gated) experience with documented UX, all safety properties
verified by tests, and full suite green.

**Evidence.** Acceptance-suite runs, safety-property tests, UX walkthrough.

---

## L4 — Product Surface Alignment

**Objective.** Align actual behavior with every public product surface.

**In scope.**
- README;
- CLI help and commands;
- ADR index (`docs/adr/`);
- configuration documentation;
- experimental/support status labels;
- product claims;
- real limitations.

**Out of scope.** Behavior changes (documentation follows behavior; any
needed behavior fix routes back to the owning stage).

**Dependencies.** L3 accepted.

**Entry criteria.** L3 accepted; behavior frozen for the release candidate.

**Completion criteria.** Every public claim traceable to verified behavior;
no documented command or option that does not exist; limitations recorded.

**Evidence.** Doc-vs-behavior audit table.

---

## L5 — Real-Environment Validation

**Objective.** Collect release evidence in real environments, not fixtures.

**In scope.**
- Live OpenRouter requests.
- Real Figma MCP through supported transports.
- Playwright browser capture.
- A representative registered project.
- Successful apply and validation.
- Controlled validation failure and rollback.
- Visual comparison and correction loop.
- Isolated installation from the packed npm artifact.

**Out of scope.** Treating unit, fake-service, or mocked evidence as
real-environment evidence.

**Dependencies.** L4 accepted.

**Entry criteria.** L4 accepted; operator-supplied credentials (OpenRouter,
Figma) and a target project available.

**Completion criteria.** Each scenario executed against the real dependency
with captured transcripts/artifacts; failures triaged to owning stages.

**Evidence.** Live-run transcripts, screenshots, rollback logs, install logs.

---

## L6 — Release Candidate and Go/No-Go

**Objective.** Run all release gates and issue a formal launch recommendation.

**In scope.**
- Execute every gate in `docs/launch/LAUNCH_GATES.md`.
- Inspect the distributable (`npm pack` contents).
- Prepare release notes and known limitations.
- Issue a formal go/no-go recommendation.

**Out of scope.** New fixes beyond gate-blocking issues; scope additions.

**Dependencies.** L5 accepted.

**Entry criteria.** L5 accepted; all gates have current status.

**Completion criteria.** Every gate PASS or explicitly waived by the program
owner; recommendation recorded.

**Evidence.** Completed gate table, distributable inspection, release notes.

---

## Post-launch architecture track (NOT launch scope)

These items are documented as post-launch evolution. They must not silently
enter the launch scope; adding any of them to L0–L6 requires an explicit
roadmap change accepted by the program owner.

- Independent reusable agent packages.
- Workflow manager / agent-graph runtime.
- Project intelligence using `ts-morph` and `@ast-grep/napi`.
- Hybrid FileStore + Supabase persistence.
- Broader web-dashboard parity.
- Commander.js and `@clack/prompts` migration (of `apps/designflow-cli`).
- Larger workflow-package and composition-root refactors.
