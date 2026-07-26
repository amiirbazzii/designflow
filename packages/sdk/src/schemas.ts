import { z } from "zod";

export const capabilityTypeSchema = z.enum([
  "pure",
  "generative",
  "read_fs",
  "write_fs",
  "human_gate",
]);

export type CapabilityType = z.infer<typeof capabilityTypeSchema>;

export const artifactLineageSchema = z.object({
  executionId: z.string().min(1),
  workflowId: z.string().min(1),
  capabilityId: z.string().min(1),
  parents: z.array(z.string()).default([]),
});

export type ArtifactLineage = z.infer<typeof artifactLineageSchema>;

export const artifactRefSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
  lineage: artifactLineageSchema.optional(),
});

export type ArtifactRef = z.infer<typeof artifactRefSchema>;

export const executionContextSchema = z.object({
  runId: z.string().min(1),
  workflowId: z.string().min(1),
  stateRef: z.string().min(1),
  artifacts: z.array(artifactRefSchema).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
  signal: z.custom<AbortSignal>(),
});

export type ExecutionContext = z.infer<typeof executionContextSchema>;

export const workflowMetadataSchema = z.object({
  version: z.string().optional(),
  author: z.string().optional(),
  tags: z.array(z.string()).default([]),
  created: z.string().datetime().optional(),
  updated: z.string().datetime().optional(),
});

export type WorkflowMetadata = z.infer<typeof workflowMetadataSchema>;

export const nodeExecutionOptionsSchema = z.object({
  retryPolicy: z
    .object({
      maxAttempts: z.number().int().positive(),
      delay: z.number().nonnegative(),
    })
    .optional(),
  timeout: z.number().positive().optional(),
  dependsOn: z.array(z.string()).optional(),
});

export type NodeExecutionOptions = z.infer<typeof nodeExecutionOptionsSchema>;

/**
 * A node that executes a single capability.
 *
 * `kind` is optional for backward compatibility: nodes authored before the
 * composition layer omit it entirely and are treated as capability nodes.
 */
export const capabilityNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("capability").optional(),
  capabilityId: z.string().min(1),
  label: z.string().optional(),
  inputMap: z.record(z.string(), z.unknown()).default({}),
  execution: nodeExecutionOptionsSchema.optional(),
  next: z.array(z.string()).default([]),
});

export type CapabilityNode = z.infer<typeof capabilityNodeSchema>;

/** A node that executes another workflow as a child execution. */
export const workflowNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("workflow"),
  workflowId: z.string().min(1),
  label: z.string().optional(),
  inputMap: z.record(z.string(), z.unknown()).default({}),
  execution: nodeExecutionOptionsSchema.optional(),
  next: z.array(z.string()).default([]),
});

export type WorkflowNode = z.infer<typeof workflowNodeSchema>;

/**
 * Tagged union of everything a workflow DAG node can be.
 *
 * `workflowNodeSchema` is tried first so that the absence of
 * `kind: "workflow"` falls through to the (backward compatible) capability
 * node shape.
 */
export const workflowStepNodeSchema = z.union([
  workflowNodeSchema,
  capabilityNodeSchema,
]);

export type WorkflowStepNode = z.infer<typeof workflowStepNodeSchema>;

export function isWorkflowNode(node: WorkflowStepNode): node is WorkflowNode {
  return node.kind === "workflow";
}

export function isCapabilityNode(
  node: WorkflowStepNode,
): node is CapabilityNode {
  return node.kind !== "workflow";
}

export const workflowDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  nodes: z.array(workflowStepNodeSchema).default([]),
  metadata: workflowMetadataSchema.default({}),
});

export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

export const saveCheckpointPayloadSchema = z.object({
  workflowId: z.string().min(1),
  checkpointId: z.string().min(1),
  state: z.unknown(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const checkpointRecordSchema = z.object({
  checkpointId: z.string().min(1),
  timestamp: z.number(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type CheckpointRecord = z.infer<typeof checkpointRecordSchema>;

export {
  workflowManifestSchema,
  semanticVersionSchema,
} from "./workflow-manifest";
export type { WorkflowManifest, SemanticVersion } from "./workflow-manifest";

export const executionPhaseSchema = z.enum([
  "started",
  "executing",
  "completed",
  "failed",
]);

export type ExecutionPhase = z.infer<typeof executionPhaseSchema>;

export const executionCheckpointSchema = z.object({
  workflowId: z.string().min(1),
  executionId: z.string().min(1),
  phase: executionPhaseSchema,
  timestamp: z.number(),
  stateRef: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type ExecutionCheckpoint = z.infer<typeof executionCheckpointSchema>;

export const errorMetadataSchema = z.record(z.string(), z.unknown());