# `@designflow/sdk`

Public API contracts, interface definitions, Zod schema definitions, plugin registration protocols, and base custom error types for DesignFlow.

## Dependency Boundaries

- **Zero internal monorepo dependencies.**
- Zero heavy third-party runtime dependencies.

SDK owns public contracts, ports, boundary schemas, and errors. It must not
depend on concrete infrastructure or import any application package.

```ts
import { artifactRefSchema, type ExecutionContract } from "@designflow/sdk";
```

Deep imports into `packages/sdk/src` are forbidden.
