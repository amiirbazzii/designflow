// packages/core/src/materialization/index.ts
export { RegistryArtifactMaterializer } from "./materializer";
export type { RegistryArtifactMaterializerOptions } from "./materializer";
export { checkArtifact, resolveSourceExecutionId } from "./validation";
export type {
  MaterializationCheck,
  MaterializationIssue,
  MaterializationIssueKind,
  MaterializedArtifact,
} from "./validation";
