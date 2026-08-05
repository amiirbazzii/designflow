# `@designflow/models`

Owns model profiles, provider registration, and provider-neutral model runtime
selection. It must not make network calls itself, choose workflow policy, or
parse CLI arguments.

```ts
import { createModelRegistry } from "@designflow/models";
```

Provider implementations belong in packages such as
`@designflow/model-provider-openrouter`.
