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
   - Trace the existing owner, tests, contracts, and reusable infrastructure.
   - Confirm the task stays inside the Fresh UI MVP boundary.

2. **Plan**
   - State the smallest file and behavior scope.
   - Preserve existing package boundaries and deterministic host authority.
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
   - Confirm no existing-project behavior leaked into the fresh-project path.

6. **Report**
   - Summarize changed files, behavior, validation results, limitations, and
     follow-up work.
   - Do not commit, push, or broaden the task unless explicitly authorized.

Do not introduce architecture merely for future possibilities. Keep the phase
small, testable, and deterministic.
