# `@designflow/core`

Workflow orchestration engine, DAG & state graph resolver, pipeline execution engine, and lifecycle coordinator for DesignFlow.

## Dependency Boundaries

- **Depends on `@designflow/sdk`, `@designflow/artifacts`, and `@designflow/state`.**

Core owns deterministic compilation, DAG execution, lifecycle, planning,
policy evaluation, approvals, and composition. It must not own CLI output,
filesystem implementations, HTTP clients, model providers, or Figma adapters.

Use the package root (`@designflow/core`). The former `src/service/` path is a
compatibility re-export; new code belongs under `src/application/execution/`.
