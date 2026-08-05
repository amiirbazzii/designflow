# Workflows Directory

This directory contains domain-specific workflow packages for DesignFlow.

Each child is an independently loadable package with a root `src/index.ts`.
Workflow packages own definitions, manifests, capabilities, and schemas; they
must not construct concrete infrastructure or import application composition
roots. Use package-root imports rather than paths into another workflow's
`src/` directory.
# Experimental Stage 4 implementation path

`design-to-code-implementation` is an opt-in extension of the Figma MCP path. A host must resolve a project from the registered project store, pass its project id/name/root identity, and explicitly set `enabled: true`. The workflow inspects bounded project facts, maps design tokens/components, creates an implementation plan, and emits a reviewable proposal. It does not claim visual fidelity.

Real application must use the implementation capability's approval binding and scoped file application service. Rejection leaves the project untouched; approved application creates a DesignFlow-controlled snapshot and required validation failures trigger rollback. Current Stage 4 work stops before screenshots, visual comparison, and feedback-loop correction.
