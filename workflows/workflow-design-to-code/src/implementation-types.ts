import { z } from "zod";
import { projectImplementationContextV1Schema, proposedFileChangesSchema, implementationPlanV1Schema, designSystemMappingSchema } from "@designflow/sdk";
export const implementationDestinationSchema = z.object({
  label: z.string().min(1),
  kind: z.enum(["page", "component", "new-page", "new-component"]),
  path: z.string().min(1).optional(),
  sourcePath: z.string().min(1).optional(),
}).strict();
export const implementationWorkflowInputSchema = z.object({
  enabled: z.literal(true), designFile: z.string().min(1), frames: z.array(z.string().min(1)).default([]),
  project: z.object({ id: z.string().min(1), name: z.string().min(1), rootPath: z.string().min(1) }).strict(),
  destination: implementationDestinationSchema.optional(),
  stateDirectory: z.string().min(1),
  captureScreenshots: z.boolean().default(true), refreshFigmaSource: z.boolean().default(false), allowFixtureNames: z.boolean().default(false),
  figmaSourceMode: z.enum(["placeholder", "rest", "mcp-stdio", "mcp-desktop"]).default("placeholder"), figmaSourceKind: z.enum(["current-selection", "figma-url"]).default("current-selection"), figmaServerIdentity: z.string().min(1).optional(), figmaCacheBypass: z.string().min(1).optional(),
  figmaAgentVersion: z.string().min(1), figmaAgentModelProfileId: z.string().min(1).optional(), implementationAgentVersion: z.string().min(1), implementationAgentModelProfileId: z.string().min(1).default("implementation-default"), visualValidationAgentVersion: z.string().min(1).default("0.1.0"), visualValidationAgentModelProfileId: z.string().min(1).optional(),
}).strict();
export type ImplementationWorkflowInput = z.infer<typeof implementationWorkflowInputSchema>;
export const IMPLEMENTATION_ARTIFACT_IDS = { projectContext: "project-implementation-context", mapping: "design-system-mapping", agentOutput: "implementation-agent-output", plan: "implementation-plan", proposal: "proposed-file-changes", moduleValidation: "proposed-module-validation", coverage: "implementation-coverage", approval: "implementation-approval", snapshot: "project-snapshot", application: "file-application-result", validation: "implementation-validation", generated: "generated-implementation", summary: "stage-4-summary" } as const;
export const IMPLEMENTATION_ARTIFACT_TYPES = { projectContext: "project.implementation-context", mapping: "design.system-mapping", agentOutput: "code.implementation-agent-output", plan: "code.implementation-plan", proposal: "code.proposed-file-changes", moduleValidation: "validation.proposed-modules", coverage: "validation.implementation-coverage", approval: "code.implementation-approval", snapshot: "code.project-snapshot", application: "code.file-application-result", validation: "validation.implementation", generated: "code.generated-implementation", summary: "design.stage-4-summary" } as const;
export { projectImplementationContextV1Schema, designSystemMappingSchema, implementationPlanV1Schema, proposedFileChangesSchema };
