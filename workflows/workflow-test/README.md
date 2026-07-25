# @designflow/workflow-test

System verification workflow for DesignFlow.

Proves the end-to-end pipeline:
- Capability definition → Registry → Compiler → ExecutionEngine → Validation → Apply

Contains a single `TestArtifactCapability` that accepts a message and produces an `ArtifactRef`.
