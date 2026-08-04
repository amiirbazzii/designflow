# ADR: Stage 5 read-only visual validation

## Decision

Stage 5 runs immediately after the approved Stage 4 generated-implementation
artifact, inside the experimental implementation workflow. It is a straight,
read-only tail: it never enters the approval gate, writes a project file, or
creates a correction proposal. Keeping the boundary in the same workflow lets
the engine retain lineage and ensures rejection or validation rollback cannot
reach visual validation because no generated artifact exists in either case.

The preview lifecycle, browser context, pages, and child process are owned by
one bounded capture capability. A live server is never reused across runs.

## Evidence and comparison

The versioned SDK contracts distinguish implementation screenshots, reference
screenshots, deterministic findings, agent interpretation, and the final
report. Reference screenshots are labeled `real-figma`, `fake-mcp`, or
synthetic; fake-MCP data is never presented as real Figma evidence. When a
reference payload is unavailable, geometry/specification checks may still be
reported, but the overall result is `inconclusive` rather than a fidelity pass.

Deterministic evidence is authoritative. The specialized Visual Validation
Agent receives the deterministic findings and may add only structured,
evidence-bound interpretation. Unknown evidence references are rejected.

## Browser and security model

Playwright is an optional runtime dependency. In this monorepo it is installed
at the repository root for development with `bun add -d playwright`, and is
declared as an optional dependency of `apps/designflow-cli` so an installed
CLI can resolve the package without depending on a disposable target project:

```bash
bun add -d playwright
bun add --cwd apps/designflow-cli --optional --exact playwright@1.62.1
bunx playwright install chromium
```

The last command installs Chromium into Playwright's external browser cache;
Chromium is not bundled into the npm package. The CLI uses a clean browser
context when the package and browser executable are available; otherwise it
records `renderer_unavailable` and does not claim a pass. Local preview
commands are discovered only from the registered project's declared package
scripts, invoked as executable-plus-argv with `shell: false`, bound to
`127.0.0.1`, and assigned an ephemeral port.

Browser setup for local capture is:

```bash
bun add -d playwright
bunx playwright install chromium
```

CI and deterministic tests may inject the renderer boundary with a synthetic
fixture. Browser contexts, pages, servers, and child processes are closed on
success, failure, timeout, and cancellation. Environment variables are not
copied into the preview process unless explicitly allow-listed, and secret-like
names are excluded.

## Policy and reuse

Critical findings, major deterministic findings, render failures, and missing
required viewports fail. Missing reference evidence is inconclusive. Only
minor/info findings can produce `pass_with_findings`; no findings with complete
reference coverage produce `pass`.

Screenshot reuse is intentionally conservative. The identity includes project
root and fingerprint, generated implementation, specification and Figma
snapshot references, viewports, capture settings, renderer, comparison version,
agent version, and model profile. Live preview and browser state are never
reused.

Stage 6 correction proposals and feedback loops are intentionally not part of
this decision.
