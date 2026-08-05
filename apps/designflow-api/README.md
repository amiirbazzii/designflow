# `@designflow/api`

Owns the HTTP application host and request routing for the DesignFlow API.
Its composition root wires product use cases, workflows, storage, and runtime
adapters.

It must not move HTTP concerns into SDK/core or expose concrete infrastructure
through reusable domain packages. Consumers use the package root or the
`wf-api` executable.
