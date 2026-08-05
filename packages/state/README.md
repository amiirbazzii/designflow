# `@designflow/state`

Execution state tracking, state graph snapshots, state machine transitions, and state history recording for DesignFlow.

## Dependency Boundaries

- **Depends on `@designflow/sdk` and `@designflow/artifacts`.**

It must not own storage technology selection, CLI behavior, or workflow
execution. Concrete stores belong in `storage-file` or `storage-sqlite`.
