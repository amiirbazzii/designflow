# `@designflow/workflow-design-to-code`

Owns the design-to-code workflow definitions, capability composition, typed
artifact schemas, visual-validation runtime contracts, and workflow-local
tests.

It must not construct CLI, OpenRouter, filesystem, or Figma Desktop runtimes.
Hosts inject those through typed ports. Import the workflow through the package
root:

```ts
import { designToCodeWorkflow } from "@designflow/workflow-design-to-code";
```
