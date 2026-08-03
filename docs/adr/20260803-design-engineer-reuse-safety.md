# Design Engineer Reuse Safety, Honest Messaging, and Artifact Inspection

**Date:** 2026-08-03
**Status:** Accepted
**Stage:** 1 (Design Engineer improvement roadmap)

## Context

A prior audit of the Design Engineer worker and the `design-to-code` workflow
found three problems worth fixing before any real Figma integration or
multi-agent architecture is layered on top:

1. **Unsafe artifact reuse.** `design-to-code`'s five artifacts
   (`design-analysis`, `design-tokens`, `component-tree`, `source-code`,
   `validation-report`) are registered under fixed, global logical ids,
   shared across every run of the workflow regardless of project, design
   file, frame selection or framework. The production reuse resolver
   (`apps/designflow-cli/src/services/cli-runner.ts`'s `createReuseResolver`)
   granted reuse whenever an artifact with that id already existed, checked
   only against a `changedArtifacts` metadata key that no product code path
   ever populated outside test harnesses. In practice this meant a second run
   — for any design, any project, any framework — could report `Created 0,
   Reused 5` purely because five artifacts with those names already existed
   from an earlier, unrelated run. Four of the five workflow nodes also
   declared an empty `inputMap`, so even the engine's own `inputFingerprint`
   (computed from a node's resolved input) was a constant, uninformative
   value for those nodes.
2. **Misleading messaging.** The approval gate on `generate-code` said
   "Writing changes to production files" / "Approve generated code
   changes?", and the CLI's approval and completion screens said "Generate
   production files" — all of it implying the workflow writes into a user's
   project. It does not: `generate-code` only stores its output as a
   DesignFlow artifact (see `workflows/workflow-design-to-code/src/artifact-io.ts`).
3. **No way to inspect a run's output.** `designflow history` and `designflow
   traces` deliberately expose only metadata — no command surfaced an
   artifact's actual content, dependencies, or file paths.

## Decision

### 1. Reuse identity, not artifact-id existence

Reuse now depends on a fingerprint folding together everything that can
change what a node would produce:

- the node's resolved input (fixed so every node maps what it actually
  reads — see "Input maps" below);
- the versions of the artifacts it depends on;
- the capability's own id and version (`Capability.version`, a new optional
  SDK field, defaulting to `"1"`);
- the enclosing workflow's id and version;
- a fixed `REUSE_SCHEMA_VERSION` constant (`packages/sdk/src/reuse-identity.ts`),
  bumped only when this scheme itself changes;
- whatever reuse identity the host attaches to the execution — project id,
  a content fingerprint of the project's current facts, model profile id,
  agent version (`packages/sdk/src/reuse-identity.ts`'s `ReuseIdentity`,
  threaded through `ExecutionContext.metadata` under a reserved key).

`ExecutionEngine.buildReuseFingerprint` (`packages/core/src/engine.ts`)
computes this once per node execution and stamps it onto every artifact the
node produces (`metadata.reuseFingerprint`), but only when a reuse resolver is
actually configured — a host with none configured sees exactly the artifact
metadata it always did.

The reuse decision itself moved into a single shared implementation,
`createArtifactFingerprintReuseResolver` (`packages/core/src/reuse-resolver.ts`),
replacing the two near-identical, ad hoc copies that previously lived in
`cli-runner.ts` and the design-to-code test harness. It keeps the existing
"declared change set" check (still used by resume/incremental planning) and
adds a second, mandatory check: an artifact is only reusable if its *stored*
`reuseFingerprint` matches the one this request would produce *right now*. An
artifact with no stored fingerprint — anything produced before this change —
never matches, because `undefined` cannot equal a fingerprint string. That is
what makes pre-Stage-1 artifacts safely non-reusable with no separate
migration pass: the safest of the three options this stage considered (the
alternatives were migrating old metadata when enough identity information
exists, or isolating a new logical-id namespace — both larger, riskier
changes for a correctness fix).

### 2. Input maps

Of `design-to-code`'s five nodes, only `analyze-design` mapped real workflow
input (and it over-mapped: `{ $workflowInput: true }` included `framework`
and `preferences`, which `analyzeDesignCapability` never reads, so a
framework-only change would have spuriously invalidated the design analysis
too). The fix:

- `analyze-design` now maps only `designFile` and `frames` — what it
  actually reads.
- `create-component-structure` now maps `framework` explicitly — it reads
  `framework` directly from workflow input (`readFramework` in
  `capabilities/index.ts`), not from an upstream artifact, so an empty map
  let a framework change go undetected.
- `extract-design-tokens`, `generate-code` and `validate-output` keep empty
  input maps deliberately: each reads only its upstream artifact, and that
  artifact's dependency version (already part of the fingerprint) is what
  should invalidate them.

The result: an unrelated design, a different framework, a different frame
selection, a different project, or an out-of-band change to an upstream
artifact all correctly force regeneration; a genuinely identical rerun still
reuses safely and cheaply.

### 3. Honest messaging

- `designToCodeApprovalPolicy`'s gate now reads "Generate and store code as a
  DesignFlow artifact?" / "Storing generated code as a DesignFlow artifact —
  no project files are changed."
- The CLI's approval screen (`apps/designflow-cli/src/commands/session-flow.ts`)
  and the demo app's approval screen (`apps/designflow-demo/src/screens/index.ts`)
  both say "Store the generated result as a DesignFlow artifact" instead of
  "Generate production files" / "Generate production code files."
- The completion screen states "No files were written to your project."
  whenever a run completes, and (when there is something to inspect) prints
  "Inspect the result: designflow artifacts \<run-id\>".

### 4. Artifact inspection

- `packages/product/src/artifact-inspection.ts`: `ArtifactInspectionService`
  reads an artifact's stored payload back through the same registry and
  payload store the engine writes through, redacting anything under a
  credential-shaped key (`apiKey`, `accessToken`, `secret`, `password`,
  `credential`, `Authorization`, ...) recursively, at any depth.
- `designflow artifacts <run-id> [artifact-id]` (`apps/designflow-cli/src/commands/artifacts.ts`):
  lists a run's named artifacts (id, name, status), or shows one artifact's
  status, version, dependencies and payload. Source-code artifacts print
  their framework and each file's path and contents; everything else prints
  as formatted JSON. Display text is bounded (`truncateForDisplay`, 20,000
  characters) and says so when it cuts something off.
- The interactive shell offers "View artifacts now?" right after a
  completed run, reusing the same list/detail rendering. The direct
  `designflow run <worker>` command does not ask this — it is a single
  command whose scripted answers are exactly its declared input fields, and
  only the interactive shell loops back to a menu afterward.

## Consequences

- Reuse is now safe by construction rather than by accident of naming: two
  different requests can never be told they produced the same thing unless
  their fingerprints genuinely agree.
- Every artifact a capability produces now carries a small amount of extra
  metadata (`reuseFingerprint`) whenever a reuse resolver is configured. A
  capability that re-executes with a genuinely different identity (a
  different project, most commonly) will version-bump its logical artifact
  even if the visible payload is identical — a cosmetic side effect of
  sharing one logical id across projects, not a correctness problem. A later
  stage could scope logical ids by project instead, if that history
  ever becomes noisy enough to matter.
- `Capability.version` and the SDK's `ReuseIdentity`/`REUSE_SCHEMA_VERSION`
  are additive, optional surfaces — no existing capability or workflow needed
  to change to keep working.
- This stage does not add Figma connectivity, real project file writes, or
  the multi-agent architecture. The Design Engineer's underlying pipeline is
  otherwise unchanged: same five capabilities, same DAG, same approval gate,
  same checkpoint/resume behavior.

## Follow-up (explicitly out of scope here)

- Real Figma API integration (URL/file-key/node-id parsing, real token/style/
  component fetching) — Stage 2+.
- Real file writes into a project's source tree, with rollback/backup —
  Stage 2+.
- Threading project facts into the workflow's *capabilities* (today they
  only reach the agent's decision prompt) so generated output actually
  reflects a project's framework/conventions.
- Scoping logical artifact ids by project, if cross-project version-history
  noise becomes a real problem.
