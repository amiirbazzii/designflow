import { z } from "zod";

export const STAGE4_SCHEMA_VERSION = "1";

export const projectInspectionWarningSchema = z.object({
  code: z.string().min(1), message: z.string().min(1), path: z.string().min(1).optional(),
}).strict();
export type ProjectInspectionWarning = z.infer<typeof projectInspectionWarningSchema>;

export const tokenSourceReferenceSchema = z.object({
  path: z.string().min(1), kind: z.string().min(1), evidence: z.array(z.string().min(1)).default([]),
}).strict();
export type TokenSourceReference = z.infer<typeof tokenSourceReferenceSchema>;

export const normalizedProjectTokenSchema = z.object({
  name: z.string().min(1), category: z.enum(["color", "typography", "spacing", "radii", "shadows", "breakpoints", "z-index", "motion"]),
  reference: z.string().min(1), value: z.string().min(1).optional(), sourcePath: z.string().min(1),
}).strict();
export type NormalizedProjectToken = z.infer<typeof normalizedProjectTokenSchema>;

export const componentSourceReferenceSchema = z.object({
  path: z.string().min(1), importPath: z.string().min(1).optional(), exportedNames: z.array(z.string().min(1)).default([]),
}).strict();
export type ComponentSourceReference = z.infer<typeof componentSourceReferenceSchema>;

export const existingComponentReferenceSchema = z.object({
  name: z.string().min(1), sourcePath: z.string().min(1), importPath: z.string().min(1).optional(),
  props: z.array(z.object({ name: z.string().min(1), type: z.string().min(1).optional() }).strict()).default([]),
  variants: z.array(z.string().min(1)).default([]), styling: z.string().min(1).optional(), role: z.string().min(1).optional(),
  safeToReuse: z.boolean(), evidence: z.array(z.string().min(1)).default([]),
}).strict();
export type ExistingComponentReference = z.infer<typeof existingComponentReferenceSchema>;

export const safeProjectCommandSchema = z.object({
  name: z.enum(["format", "typecheck", "lint", "build", "test", "preview"]), scriptName: z.string().min(1).optional(), executable: z.string().min(1), args: z.array(z.string()).default([]),
  source: z.enum(["package-script", "project-config", "designflow-settings"]), required: z.boolean(),
}).strict();
export type SafeProjectCommand = z.infer<typeof safeProjectCommandSchema>;

export const projectImplementationContextV1Schema = z.object({
  schemaVersion: z.literal("1"),
  project: z.object({ id: z.string().min(1), rootIdentity: z.string().min(1), contextFingerprint: z.string().min(1) }).strict(),
  runtime: z.object({ framework: z.string().min(1), frameworkVersion: z.string().optional(), language: z.enum(["typescript", "javascript"]), packageManager: z.string().min(1), monorepo: z.boolean() }).strict(),
  structure: z.object({ sourceRoots: z.array(z.string().min(1)), routeRoots: z.array(z.string().min(1)), publicAssetRoots: z.array(z.string().min(1)), aliases: z.record(z.string()) }).strict(),
  styling: z.object({ strategies: z.array(z.string().min(1)), primaryStrategy: z.string().optional(), evidence: z.array(z.string().min(1)) }).strict(),
  designSystem: z.object({ tokenSources: z.array(tokenSourceReferenceSchema), tokens: z.array(normalizedProjectTokenSchema), componentSources: z.array(componentSourceReferenceSchema), components: z.array(existingComponentReferenceSchema) }).strict(),
  conventions: z.object({ naming: z.array(z.string()), fileLayout: z.array(z.string()), exports: z.array(z.string()), props: z.array(z.string()), testing: z.array(z.string()), accessibility: z.array(z.string()) }).strict(),
  commands: z.object({ format: safeProjectCommandSchema.optional(), typecheck: safeProjectCommandSchema.optional(), lint: safeProjectCommandSchema.optional(), build: safeProjectCommandSchema.optional(), test: safeProjectCommandSchema.optional(), preview: safeProjectCommandSchema.optional() }).strict(),
  warnings: z.array(projectInspectionWarningSchema),
}).strict();
export type ProjectImplementationContext = z.infer<typeof projectImplementationContextV1Schema>;

export const designSystemMappingSchema = z.object({
  schemaVersion: z.literal("1"),
  tokenMappings: z.array(z.object({ designTokenId: z.string().min(1), projectTokenReference: z.string().min(1).optional(), confidence: z.number().min(0).max(1), action: z.enum(["reuse", "create", "manual-review"]), reason: z.string().min(1) }).strict()),
  componentMappings: z.array(z.object({ designComponentId: z.string().min(1), projectComponentReference: z.string().min(1).optional(), confidence: z.number().min(0).max(1), action: z.enum(["reuse", "extend", "create", "manual-review"]), reason: z.string().min(1) }).strict()),
  assetMappings: z.array(z.object({ designAssetId: z.string().min(1), projectAssetReference: z.string().min(1).optional(), action: z.enum(["reuse", "import", "manual-review"]), reason: z.string().min(1) }).strict()),
  unresolved: z.array(z.object({ code: z.string().min(1), description: z.string().min(1), requiresUserInput: z.boolean() }).strict()),
}).strict();
export type DesignSystemMapping = z.infer<typeof designSystemMappingSchema>;

export const implementationPlanV1Schema = z.object({
  schemaVersion: z.literal("1"), objective: z.string().min(1), selectedNodeIds: z.array(z.string().min(1)), targetRoute: z.string().min(1).optional(),
  reuseComponents: z.array(z.string()), extendComponents: z.array(z.string()), createComponents: z.array(z.string()), reuseTokens: z.array(z.string()), addTokens: z.array(z.string()), assets: z.array(z.string()), statePlan: z.array(z.string()), responsivePlan: z.array(z.string()), accessibilityPlan: z.array(z.string()), proposedFileActions: z.array(z.object({ path: z.string().min(1), action: z.enum(["create", "modify"]) }).strict()), dependencyChanges: z.array(z.string()), validationPlan: z.array(z.string()), assumptions: z.array(z.string()), unresolvedQuestions: z.array(z.string()), agent: z.object({ id: z.string().min(1), version: z.string().min(1), modelProfileId: z.string().min(1), schemaVersion: z.string().min(1) }).strict(),
}).strict();
export type ImplementationPlanV1 = z.infer<typeof implementationPlanV1Schema>;

export const safeProjectCommandReferenceSchema = z.object({ name: z.enum(["format", "typecheck", "lint", "build", "test", "preview"]), required: z.boolean() }).strict();
export const proposedFileChangesSchema = z.object({
  schemaVersion: z.literal("1"), projectId: z.string().min(1), baseProjectFingerprint: z.string().min(1), files: z.array(z.object({ path: z.string().min(1), action: z.enum(["create", "modify", "delete"]), content: z.string().optional(), patch: z.string().optional(), expectedBaseHash: z.string().min(1).optional(), reason: z.string().min(1), relatedDesignNodeIds: z.array(z.string().min(1)) }).strict()), packageChanges: z.array(z.object({ packageName: z.string().min(1), action: z.enum(["add", "remove", "update"]), requestedVersion: z.string().min(1).optional(), reason: z.string().min(1) }).strict()), commandsRequested: z.array(safeProjectCommandReferenceSchema), assumptions: z.array(z.string()), unresolvedItems: z.array(z.string()),
}).strict();
export type ProposedFileChanges = z.infer<typeof proposedFileChangesSchema>;

export const implementationApprovalBindingSchema = z.object({
  approvalId: z.string().min(1), proposalArtifactId: z.string().min(1), proposalHash: z.string().min(1), projectId: z.string().min(1), baseProjectFingerprint: z.string().min(1), createdAt: z.string().min(1), expiresAt: z.string().min(1).optional(), status: z.enum(["pending", "approved", "rejected"]),
}).strict();
export type ImplementationApprovalBinding = z.infer<typeof implementationApprovalBindingSchema>;

export const implementationValidationReportSchema = z.object({
  schemaVersion: z.literal("1"), projectId: z.string().min(1), proposalArtifactId: z.string().min(1), applicationArtifactId: z.string().min(1), checks: z.array(z.object({ name: z.enum(["format", "typecheck", "lint", "build", "test"]), status: z.enum(["passed", "failed", "skipped", "unavailable"]), required: z.boolean(), command: z.array(z.string().min(1)).optional(), commandReference: z.string().optional(), exitCode: z.number().int().optional(), durationMs: z.number().nonnegative().optional(), timedOut: z.boolean().optional(), stdout: z.string().optional(), stderr: z.string().optional(), logArtifactId: z.string().optional(), summary: z.string().min(1) }).strict()), passed: z.boolean(), rollbackTriggered: z.boolean(), rollbackArtifactId: z.string().optional(), warnings: z.array(z.string()),
}).strict();
export type ImplementationValidationReport = z.infer<typeof implementationValidationReportSchema>;

export const generatedImplementationV1Schema = z.object({
  schemaVersion: z.literal("1"), projectId: z.string().min(1), designSpecificationArtifactId: z.string().min(1), projectContextArtifactId: z.string().min(1), mappingArtifactId: z.string().min(1), implementationPlanArtifactId: z.string().min(1), proposalArtifactId: z.string().min(1), applicationArtifactId: z.string().min(1), validationArtifactId: z.string().min(1), changedFiles: z.array(z.string()), createdFiles: z.array(z.string()), modifiedFiles: z.array(z.string()), dependencyChanges: z.array(z.string()), reusedComponents: z.array(z.string()), reusedTokens: z.array(z.string()), assumptions: z.array(z.string()), unresolvedItems: z.array(z.string()), agentId: z.string().min(1), agentVersion: z.string().min(1), modelProfileId: z.string().min(1),
}).strict();
export type GeneratedImplementationV1 = z.infer<typeof generatedImplementationV1Schema>;
