# `@designflow/product`

Owns application-facing use cases, session/project/memory orchestration,
worker results, progress, narration, and product view models.

It must not own CLI presentation, browser components, concrete engine wiring,
or external provider clients. Applications consume its package-root exports:

```ts
import { WorkflowRunner } from "@designflow/product";
```

Composition roots supply infrastructure and keep the product layer portable.
