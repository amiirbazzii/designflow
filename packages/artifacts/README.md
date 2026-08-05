# `@designflow/artifacts`

Content-addressed storage, artifact lifecycle management, content hashing, indexing, and candidate diffing for DesignFlow.

## Dependency Boundaries

- **Depends only on `@designflow/sdk`.**

It must not own workflow-specific policy, CLI presentation, or external
provider clients. Import stores and artifact contracts from the package root.
