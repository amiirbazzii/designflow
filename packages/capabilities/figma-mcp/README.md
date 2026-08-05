# `@designflow/capability-figma-mcp`

Owns Figma source parsing, frame resolution, node normalization, capability
mapping, and provenance-aware screenshot retrieval over an injected MCP port.

It must not own generic MCP transport, CLI settings, or implementation file
writes. Use the package root; the Figma Desktop adapter remains a concrete
adapter behind typed contracts.
