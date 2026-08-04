# DesignFlow release notes

## Next release candidate — not yet cut

The release candidate remains intentionally unpublished and unversioned until
the Stage 7 real-integration gate passes.

### Included hardening

- Stage 1–6 deterministic workflows, evidence-bound approvals, snapshots,
  rollback, browser validation, and durable visual-correction resume behavior.
- `designflow doctor` and JSON diagnostics for local runtime, state, project,
  Figma configuration, and Playwright health.
- Git-aware write protection for dirty proposal targets and in-progress merge,
  rebase, or cherry-pick states.
- Read-only persisted-state health inspection with explicit current, legacy,
  future, and corrupt-state outcomes.
- Separate Chromium installation; browser binaries are not included in the
  npm package.

### Experimental or unavailable until verified

- Real Figma MCP retrieval is experimental and requires an operator-configured
  MCP server and environment-provided credential.
- OpenRouter/model-provider execution is optional and requires a temporary
  process environment credential.
- Real end-to-end implementation/correction acceptance is not claimed from the
  deterministic fixtures alone.

### Safety guarantees

No agent can approve its own proposal. No model output can choose arbitrary
shell commands or bypass deterministic path, hash, validation, approval,
snapshot, rollback, or visual stop-policy checks. DesignFlow never commits or
pushes user repositories.
