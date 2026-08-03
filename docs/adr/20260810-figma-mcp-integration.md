# Real Figma MCP Integration and Design Specification (Stage 3)

**Date:** 2026-08-10
**Status:** Accepted
**Stage:** 3 (Design Engineer improvement roadmap)

## Context

Stage 2 built the specialized-agent foundation — a coordinator plus three
specialized agents, workflow-mediated invocation, independent model
profiles — but the Figma Specification Agent still consumed a pure fixture
`FigmaSourceSnapshot` that `prepare-figma-source-fixture` built deterministically
from workflow input; nothing was ever fetched from Figma.

Stage 3's goal is to replace that fixture path with a real, MCP-backed
retrieval that produces a comprehensive, implementation-oriented Design
Specification — without yet generating code, writing project files, or
building a visual feedback loop.

## Decision

### 1. Package boundaries

```text
@designflow/sdk
  packages/sdk/src/mcp.ts              — generic McpClient port (protocol-level, no Figma)
  packages/sdk/src/design-engineer-contracts.ts — extended FigmaSourceSnapshot v2, DesignSpecification v2

@designflow/mcp (new)
  A concrete stdio JSON-RPC 2.0 transport (McpRuntime) — spawns a configured
  command via node:child_process, speaks newline-delimited JSON-RPC. Also
  ships a protocol-faithful fake server (fake-server-entry.ts), spawned as
  a real, separate process by every test in this repo that needs one.

@designflow/capability-figma-mcp (new)
  Figma-specific interpretation: URL/node parsing, MCP capability discovery,
  deterministic tool wrappers, frame/node resolution, screenshot artifact
  validation, and the two workflow capabilities
  (parse-figma-source, retrieve-figma-source-snapshot).
```

`@designflow/mcp` knows nothing about Figma — it is exactly as
provider-neutral as `@designflow/models`/`@designflow/model-provider-openrouter`
are about OpenRouter. `@designflow/capability-figma-mcp` knows nothing about
JSON-RPC or child processes — it only holds a `McpClient` port. Neither
package is imported by `packages/core` (the engine); its own architecture
test still passes with the same `FORBIDDEN` list as before. The Figma
capability package is named `@designflow/capability-figma-mcp` specifically
so it matches the workflow package's existing "a workflow may depend on
`@designflow/capability-*`" architecture-test allowlist — the same
extension point `@designflow/capability-test-artifact` already
demonstrated, applied to a real, non-trivial capability for the first time.

### 2. Why MCP calls remain deterministic tools, not agent-chosen tools

The Figma Specification Agent's `allowedTools` stays empty. Every MCP call
happens inside `retrieve-figma-source-snapshot`'s `execute()` — a plain,
deterministic workflow capability — which calls
`@designflow/capability-figma-mcp`'s wrapper functions directly. The agent
only ever sees the already-normalized `FigmaSourceSnapshot` this capability
produced. This is what "the workflow or deterministic adapter owns tool
selection" (the spec's own instruction) means concretely: there is no path
by which a model's output could choose which MCP tool to call, and no
"arbitrary tool name" for the agent to supply, because the agent is never
handed a tool-calling port that reaches MCP at all.

### 3. Why raw MCP payloads are normalized, never stored verbatim

`normalize-nodes.ts` reads a server's raw node tree defensively — every
field beyond `id`/`name`/`type` is optional, and a field not explicitly
modeled by name is preserved under `properties` rather than dropped or
invented. The stored `FigmaSourceSnapshot` never contains the raw MCP
response: it contains DesignFlow's own stable schema, which is what makes
the artifact safe for long-term storage, deterministic reuse comparison,
and safe inspection (no server-specific shape a person reading
`designflow artifacts` would need to learn).

### 4. Authentication and secret handling

- `figmaMcpConfig`'s `envPassthrough` names environment variables to
  forward into the spawned server's process — never a literal value.
  `figma-mcp-config.ts` reads the actual value from `process.env` only at
  the moment a client is constructed, and only that resolved `env` map (not
  the config object) ever reaches `child_process.spawn`.
- `McpToolCallResult`'s failure variant carries a stable `ERR_MCP_*` code and
  a fixed, generic message — never the server's own error text, which is
  the single most likely place a token fragment or an internal hostname
  would leak.
- The one heuristic exception, `classifyToolErrorContent` in
  `stdio-runtime.ts`, only ever *downgrades* to one of three fixed, safe
  codes based on a keyword match against the server's text — it never
  echoes that text anywhere the caller can see.
- Verified directly: `figma-mcp-config.test.ts` proves a credential value
  never appears in the config object handed back for storage/display, and
  `figma-mcp-experimental.test.ts` proves a credential forwarded via
  `envPassthrough` never appears in a run's `explain()` report.

### 5. Figma URL and node-resolution rules

`parseFigmaSource` (in `@designflow/capability-figma-mcp`) accepts a modern
`/design/<key>/...` or legacy `/file/<key>/...` figma.com URL, or a bare
file key; extracts `node-id` (accepting both `123-456` and `123:456` forms,
normalizing to the colon form) and `branch-id`; rejects any other host,
scheme, or shape. `normalizedUrl` is rebuilt from only the fields this
parser recognises — never the original query string — so a share-link
token or tracking parameter can never reach a stored artifact.

Frame/node resolution (`resolveFigmaFrames`) follows a strict priority with
no fuzzy matching: explicit node id, then exact full path, then exact name,
then case-insensitive exact name; anything left is reported as a structured
ambiguity (more than one candidate) or as missing (zero candidates) —
never silently guessed, and never silently widened to "the whole document."

### 6. Screenshot handling

Captured screenshots are validated (file-signature check against the
claimed format, size and dimension caps) before being stored as their own
artifact via the existing `ArtifactStore` — the base64 bytes live only in
the artifact's *payload*, never in its metadata, which is what a history or
trace record actually carries forward. Deduplication is not implemented as
a separate step: `ArtifactStore.save` already content-addresses its
payload, so an unchanged capture for the same node is already cheap.

### 7. Reuse identity

No change was needed to Stage 1's fingerprint mechanism. Each
MCP-backed node's own `inputMap` is deliberately narrow:

- `parse-figma-source` — `designFile`, `frames`, `allowFixtureNames`.
- `retrieve-figma-source-snapshot` — `captureScreenshots`,
  `refreshFigmaSource` only. The actual source identity (file key, node
  ids, requested frames) is **not** repeated here; it reaches this node's
  fingerprint through the ordinary `execution.dependsOn` mechanism, since a
  changed parsed source produces a new `parsed-figma-source` version.
- `invoke-figma-specification-agent` — `agentVersion`, `modelProfileId`
  only (unchanged from Stage 2).

**Known limitation, matching the spec's own anticipated fallback:** a live
document's *version* is only discoverable by actually calling the server —
this node's fingerprint is computed *before* that call, so an upstream
document change with no other input difference cannot invalidate reuse
automatically ahead of time, whether or not the server exposes a version
string. `refreshFigmaSource: true` is the documented, explicit escape
hatch: flipping it changes this node's own input and forces a fresh
retrieval. This is the one requirement (of ten listed in the spec's reuse
section) not fully automatic; every other listed behavior — different file
key, different node selection, different frame resolution, changed
screenshot content, agent-version isolation, model-profile isolation, no
cross-workflow contamination — is verified in
`figma-specification.test.ts`.

### 8. Experimental rollout

Off by default. `settings.experimental.designEngineerFigmaMcp` must be
explicitly `true` in `config.json` for `design-to-code-figma-specification`
to even be registered in the CLI's workflow map; `settings.figmaMcp` names
the server command/args/timeouts and which environment variables to
forward. With the flag unset (every existing installation), `cli-runner.ts`
behaves byte-identically to Stage 2 — verified by re-running the full
Stage 1/2 smoke-test script against the Stage 3 build, and by
`figma-mcp-experimental.test.ts`'s own "not reachable at all unless the
flag is enabled" test. No new public worker or CLI command was added; the
existing `designflow settings`/`designflow artifacts` surfaces are
sufficient to inspect what a preview run produced, and the escape hatch
this stage took (per its own "if a new command is too large, provide
equivalent internal diagnostics" allowance) was to skip a dedicated
`designflow figma status` command in favor of thorough test coverage of
the config-reading and wiring logic itself.

### 9. What remains out of scope, on purpose

- No real code generation, no project file writes — the workflow this
  stage ships has exactly four nodes (`parse-figma-source`,
  `retrieve-figma-source-snapshot`, `invoke-figma-specification-agent`,
  `store-stage-3-summary`) and stops at the Design Specification Artifact.
- The Implementation and Visual Validation agents are untouched from Stage
  2 and are not part of this workflow at all.
- No revision feedback loop.
- No automatic document-version invalidation (see §7's limitation).
- No live verification against a real Figma MCP server — see the final
  report's transparency statement on this.
