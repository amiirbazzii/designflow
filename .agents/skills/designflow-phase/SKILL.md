---
name: designflow-phase
description: Run one bounded DesignFlow roadmap phase or task through inspect, plan, implement, validate, review, and report using the repository's existing architecture and commands.
---

# DesignFlow phase workflow

Use this skill for one approved roadmap phase or one clearly bounded task.

1. **Inspect**
   - Read the applicable `AGENTS.md` files and task documentation.
   - Use the codebase-memory MCP graph for code discovery; use targeted `rg`
     and file reads for literals, configuration, and non-code files.
   - Trace the owning package/module, existing related modules, tests, contracts, reusable infrastructure, and nearest conventions.
   - Confirm the task stays inside the Fresh UI MVP boundary.

2. **Plan**
   - Before writing, record the owning package/module, related modules, files to modify, files to create and why each belongs there, and existing code to reuse.
   - State the smallest file and behavior scope and one primary responsibility per new or changed module.
   - Preserve package boundaries, app/package ownership, and deterministic host authority; do not widen public APIs without need.
   - Avoid new top-level folders/packages, catch-all modules, duplicate logic, speculative abstractions, and arbitrary line-count rules.
   - Follow the package's existing naming, export, error-handling, and test-placement conventions.
   - Define deterministic acceptance criteria and focused validation commands.

3. **Implement**
   - Make only the approved change.
   - Prefer existing Figma, gateway, browser, screenshot, artifact, and
     cancellation seams over new infrastructure.
   - Keep model decisions bounded by schemas, host policy, and explicit retry
     or repair limits.

4. **Validate**
   - Run focused tests first, then the relevant repository checks:
     `bun run build`, `bun run typecheck`, `bun run lint`, and `bun run test`.
   - Treat failures and skips as evidence to report, not as success.

5. **Review**
   - Check correctness, regression risk, architecture, security, failure and
     cancellation behavior, scope creep, and Fresh UI MVP fidelity.
   - Flag misplaced files, duplicated responsibilities or logic, oversized
     catch-alls, unnecessary folders/packages, broad exports, missing or
     misplaced tests, speculative abstractions, arbitrary size-based splitting,
     and scope creep.
   - Confirm no existing-project behavior leaked into the fresh-project path.

6. **Report**
   - Summarize changed files, behavior, validation results, limitations, and
     follow-up work.
   - Do not commit, push, or broaden the task unless explicitly authorized.

Do not introduce architecture merely for future possibilities. Keep the phase
small, testable, and deterministic.
