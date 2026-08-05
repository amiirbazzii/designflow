# `@designflow/mcp`

Owns MCP protocol types, bounded request/response validation, and stdio/HTTP
transport runtimes. Fake MCP servers are package test fixtures under `test/`.

It must not own Figma domain mapping, CLI configuration, or provider policy.
Use the package root for production imports:

```ts
import { McpRuntime } from "@designflow/mcp";
```

The fake server is intentionally not part of the public API.
