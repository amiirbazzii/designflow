# DesignFlow Codex Guidance

## Mission

DesignFlow is preparing for the Fresh UI MVP: turn one Figma frame into one
fresh, runnable, high-fidelity UI project.

The MVP generated stack is fixed:

- Vite
- React
- TypeScript
- Plain CSS

The MVP is a fresh-project path. Do not add existing-project functionality,
legacy-project parity, broad application migration, or unrelated product
surface work to this path.

## Architecture and authority

Preserve the existing package boundaries and dependency direction. The current
API, product, workflow, SDK, capability, Figma MCP, managed gateway,
Playwright, screenshot, artifact, and cancellation infrastructure are the
foundation for the pivot. Prefer adapting existing seams over duplicating
them.

The governing invariant is:

> AI supplies judgment; deterministic host supplies authority.

AI may interpret design evidence, choose among bounded options, and propose
changes. Deterministic host code owns schemas, tool selection, filesystem and
process access, approvals, writes, rollback, retry limits, validation, and
final outcomes. Never let model output directly authorize an unbounded tool,
write, retry, or scope expansion.

## Scope and implementation rules

- Make small, testable changes with one clear purpose.
- Keep each task within one roadmap phase or explicitly approved task.
- Do not refactor unrelated code or perform broad cleanup.
- Preserve compatibility paths unless the current task explicitly changes one.
- Reuse existing Figma, AI gateway, browser, screenshot, artifact, and
  cancellation infrastructure before introducing an abstraction.
- Keep retries and repair loops bounded, observable, and fail-closed.
- Do not add dependencies, hooks, Ruflo/swarm integration, or new architecture
  for speculative future use.
- Never commit secrets, credentials, `.env` files, generated output, or local
  runtime state.
- Validate inputs at boundaries, use parameterized database queries, sanitize
  rendered output, and reject path traversal.
- Keep public APIs typed and follow the repository's existing commit-message
  convention when commits are explicitly requested.
- Follow the repository's strict TypeScript and package ownership boundaries.
- Prefer the codebase-memory MCP graph for code discovery (`search_graph`,
  `trace_path`, `get_code_snippet`, `query_graph`, `get_architecture`). Fall
  back to `rg` for literals, configuration, and non-code files.

## Verified validation

Run the relevant checks for every change. The repository-level validation
commands are:

```bash
bun run build
bun run typecheck
bun run lint
bun run test
```

A task is not complete until its relevant deterministic validation passes. If a
check cannot run or a test is skipped, report that fact and its reason rather
than treating it as success. Include changed paths, commands, results, and any
remaining uncertainty in the handoff.

## Working sequence

1. Inspect the task, applicable instructions, architecture, and current tests.
2. Plan the smallest change and its deterministic acceptance criteria.
3. Implement only the approved scope.
4. Validate with focused checks, then the relevant repository commands.
5. Review for correctness, regression, architecture, security, and scope creep.
6. Report the change, evidence, limitations, and follow-up explicitly.

Do not commit, push, merge, rebase, reset, or rewrite history unless the user
explicitly authorizes that operation.
