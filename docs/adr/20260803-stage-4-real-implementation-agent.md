# ADR: Stage 4 real implementation agent

Status: accepted (experimental)

## Decision

Stage 4 extends the opt-in Figma MCP path with `design-to-code-implementation`. Project inspection is deterministic, bounded, and rooted only at a project resolved from the registered project store. It records relative paths, normalized tokens, reusable components, conventions, and declared package commands; it skips dependencies, build output, DesignFlow state, secrets, binaries, symlinks, and files beyond configured count/byte limits.

The Implementation Agent receives typed design, context, and mapping artifacts and returns an implementation plan and strongly typed file proposal. The model never receives unrestricted filesystem or shell access and never writes files. Low-confidence mappings become manual review items.

Approval binds the exact proposal artifact and content hash, project id, and base project fingerprint. The scoped application service validates relative paths, symlink containment, base hashes, file limits, and disabled deletion. It creates a DesignFlow-controlled snapshot before atomic temporary-file replacement. Application failure or required validation failure must restore the snapshot. Validation uses only allow-listed executables and project-declared scripts, with `shell: false`, timeouts, bounded redacted output, and required/optional/unavailable status.

Planning may be reused only while specification, context fingerprint, mapping, agent version, model profile, and schema identities match. Side effects and validation are never reused without checking current project state. Visual comparison, implementation screenshots, revision feedback, and correction loops remain Stage 5/6 work.

## Rollout

The public `design-to-code` workflow remains unchanged. Hosts must explicitly install and enable `design-to-code-implementation` and pass a resolved registered project identity. The CLI documentation must keep the experimental status and the current limitation that no visual fidelity claim is made.

## Consequences

This favors explainable and reviewable proposals over autonomous writes. Dependency changes are normalized as proposal data; installation is not performed by model output. The remaining Stage 5 work is visual validation, and Stage 6 is feedback/revision orchestration.
