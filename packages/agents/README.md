# `@designflow/agents`

Owns typed agent invocation, built-in agent catalogs, deterministic strategies,
agent-scoped tools/models, and agent decision validation.

It must not own provider HTTP clients, CLI prompts, filesystem access, or
workflow composition roots. Its public API is the package root (`src/index.ts`).

```ts
import { createAgentRegistry } from "@designflow/agents";
```

Do not import `packages/agents/src/*` from another package or construct an
OpenRouter client in an agent catalog.
