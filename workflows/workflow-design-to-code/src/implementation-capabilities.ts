import { z } from "zod";
import { DesignFlowError, designSpecificationSchema, generatedImplementationSchema, type Capability, implementationPlanV1Schema, proposedFileChangesSchema } from "@designflow/sdk";
import { changedExecutableFiles, deriveImplementationCoveragePlan, inspectRegisteredProject, mapDesignSystem, projectFileHash, validateImplementationCoverage, validateProposedFileChanges, validateProposedModules, type ProposedModuleDiagnostic } from "@designflow/capability-implementation";
import { analyzeRenderReachability } from "./composition-scope";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readArtifact, writeArtifact } from "./artifact-io";
import { capabilityOutputSchema, type CapabilityOutput } from "./types";
import { IMPLEMENTATION_ARTIFACT_IDS, IMPLEMENTATION_ARTIFACT_TYPES, implementationWorkflowInputSchema, projectImplementationContextV1Schema, designSystemMappingSchema } from "./implementation-types";
function requireAgents(context: import("@designflow/sdk").CapabilityContext): NonNullable<import("@designflow/sdk").CapabilityContext["agents"]> { if (!context.agents) throw new Error("Implementation Agent invocation is unavailable."); return context.agents; }

export const inspectRegisteredProjectCapability: Capability<unknown, CapabilityOutput> = { id: "inspect-registered-project", name: "Inspect registered project", description: "Builds a bounded implementation context from a registered project", type: "pure", version: "1", inputSchema: implementationWorkflowInputSchema, outputSchema: capabilityOutputSchema, async execute(context, input) { const requested = implementationWorkflowInputSchema.parse(input); const value = inspectRegisteredProject(requested.project, undefined, context.signal); return writeArtifact(context, { artifactId: IMPLEMENTATION_ARTIFACT_IDS.projectContext, artifactType: IMPLEMENTATION_ARTIFACT_TYPES.projectContext, name: "Project Implementation Context", payload: value, summary: { projectId: value.project.id, fingerprint: value.project.contextFingerprint, warningCount: value.warnings.length } }); } };
export const mapDesignSystemCapability: Capability<unknown, CapabilityOutput> = { id: "map-design-system", name: "Map design system", description: "Maps design tokens and components to bounded project facts", type: "pure", version: "1", inputSchema: z.unknown(), outputSchema: capabilityOutputSchema, async execute(context) { const spec = await readArtifact(context, "design-specification", designSpecificationSchema); const project = await readArtifact(context, IMPLEMENTATION_ARTIFACT_IDS.projectContext, projectImplementationContextV1Schema); const value = mapDesignSystem(spec, project); return writeArtifact(context, { artifactId: IMPLEMENTATION_ARTIFACT_IDS.mapping, artifactType: IMPLEMENTATION_ARTIFACT_TYPES.mapping, name: "Design System Mapping", payload: value, summary: { unresolved: value.unresolved.length } }); } };
/**
 * Bounded proposal regeneration: one implementation/correction iteration may
 * consume at most this many model proposal attempts (the initial proposal
 * plus up to two regenerations). Regeneration never increments any iteration
 * counter and never reaches an approval prompt — only a proposal that passes
 * deterministic validation continues.
 */
export const MAX_CORRECTION_PROPOSAL_ATTEMPTS = 3;

/**
 * Deterministic validation failures that are safe to repair by regenerating
 * the proposal: all are shape/path facts about the model's own output.
 * Anything else (inaccessible root, staleness, provider failure,
 * cancellation) terminates honestly without a retry.
 */
export const REPAIRABLE_PROPOSAL_ERROR_CODES: ReadonlySet<string> = new Set([
  "ERR_PROPOSAL_TARGET_MISSING",
  "ERR_PROPOSAL_TARGET_EXISTS",
  "ERR_DUPLICATE_PROPOSAL_ACTION",
  "ERR_UNSAFE_PATH",
  "ERR_PATH_TRAVERSAL",
  "ERR_UNSUPPORTED_FILE_TYPE",
  "ERR_PROPOSAL_INVALID",
  "ERR_PROPOSAL_TOO_LARGE",
  "ERR_PROPOSAL_MODULE_COMPILE_FAILED",
  "ERR_PROPOSAL_EMPTY_EXECUTABLE_CONTENT",
  "ERR_PROPOSAL_NOOP_MODIFY",
  "ERR_PROPOSAL_COVERAGE_INCOMPLETE",
  "ERR_PROPOSAL_COVERAGE_INVALID",
]);

/** Deterministic repair facts for content-integrity failures; anything else falls back to the target-existence fact. */
const CONTENT_INTEGRITY_FACTS: Readonly<Record<string, string>> = {
  ERR_PROPOSAL_EMPTY_EXECUTABLE_CONTENT: "executable source proposals must contain non-whitespace source content",
  ERR_PROPOSAL_NOOP_MODIFY: "proposed modify content is identical to the current file",
};

interface ProposalAttemptFailure { readonly attempt: number; readonly code: string; readonly path?: string; readonly operation?: string; readonly diagnostics?: readonly ProposedModuleDiagnostic[]; readonly targetId?: string; readonly targetKind?: string; readonly fact?: string; }

/** Typed, fact-only feedback for a regeneration attempt — never a rewritten operation. */
function buildProposalRepairFeedback(options: {
  readonly attempt: number;
  readonly failures: readonly ProposalAttemptFailure[];
  readonly project: {
    readonly designSystem: { readonly componentSources: readonly { readonly path: string }[]; readonly tokenSources: readonly { readonly path: string }[] };
    readonly structure: { readonly sourceRoots: readonly string[] };
  };
  readonly root: string;
}): Record<string, unknown> {
  return {
    attempt: options.attempt,
    maxAttempts: MAX_CORRECTION_PROPOSAL_ATTEMPTS,
    validationErrors: options.failures.map((failure) => ({
      code: failure.code,
      ...(failure.diagnostics !== undefined ? { moduleDiagnostics: failure.diagnostics } : {}),
      ...(failure.operation !== undefined ? { operation: failure.operation } : {}),
      ...(failure.targetId !== undefined ? { targetId: failure.targetId } : {}),
      ...(failure.targetKind !== undefined ? { targetKind: failure.targetKind } : {}),
      ...(failure.fact !== undefined && failure.path === undefined ? { fact: failure.fact } : {}),
      ...(failure.path !== undefined
        ? {
            path: failure.path,
            fact: failure.fact ?? CONTENT_INTEGRITY_FACTS[failure.code] ?? (existsSync(join(options.root, failure.path))
              ? "target already exists as a regular file"
              : "target does not exist"),
          }
        : {}),
    })),
    relevantProjectFacts: {
      existingComponentSourcePaths: options.project.designSystem.componentSources.map((source) => source.path),
      existingTokenSourcePaths: options.project.designSystem.tokenSources.map((source) => source.path),
      sourceRoots: options.project.structure.sourceRoots,
      rule: "use action 'modify' only for a path that exists; use action 'create' only for a vacant relative path",
    },
  };
}

export const invokeImplementationAgentStage4Capability: Capability<unknown, CapabilityOutput> = { id: "invoke-implementation-agent", name: "Invoke Implementation Agent", description: "Produces a schema-validated implementation output from bounded context", type: "pure", version: "1", inputSchema: implementationWorkflowInputSchema, outputSchema: capabilityOutputSchema, async execute(context, input) { const requested = implementationWorkflowInputSchema.parse(input); const spec = await readArtifact(context, "design-specification", designSpecificationSchema); const project = await readArtifact(context, IMPLEMENTATION_ARTIFACT_IDS.projectContext, projectImplementationContextV1Schema); const mapping = await readArtifact(context, IMPLEMENTATION_ARTIFACT_IDS.mapping, designSystemMappingSchema); const root = requested.project.rootPath;
    const failures: ProposalAttemptFailure[] = [];
    // Host-derived required design surface: the model receives the plan, may
    // choose how to satisfy each target, but can never redefine the targets.
    const coveragePlan = deriveImplementationCoveragePlan(spec, mapping, project);
    let repairFeedback: Record<string, unknown> | undefined;
    for (let attempt = 1; attempt <= MAX_CORRECTION_PROPOSAL_ATTEMPTS; attempt += 1) {
      if (context.signal?.aborted === true) throw new DesignFlowError("ERR_PROPOSAL_ATTEMPT_CANCELLED", "Proposal generation was cancelled; no further attempt will start.", { attempt });
      const outcome = await requireAgents(context).invoke({ agentId: "implementation-agent", objective: "Produce a structured implementation proposal for the registered project", input: { designSpecification: spec, projectContext: project, designSystemMapping: mapping, coveragePlan, ...(repairFeedback !== undefined ? { proposalRepairFeedback: repairFeedback } : {}) }, attempt }, context.signal);
      if (outcome.type === "failure") throw new Error(`Implementation Agent failed: ${outcome.code}`);
      const value = generatedImplementationSchema.parse(outcome.output);
      // Deterministic pre-validation of the exact proposal this output would
      // become — the same rules the proposal step enforces — so an invalid
      // shape triggers bounded regeneration instead of terminating the run.
      try {
        const attemptProposal = proposedFileChangesSchema.parse({ schemaVersion: "1", projectId: project.project.id, baseProjectFingerprint: project.project.contextFingerprint, files: value.files.map((file) => { const baseHash = file.action === "modify" ? projectFileHash(join(root, file.path)) : undefined; return { path: file.path, action: file.action, content: file.content, ...(baseHash !== undefined ? { expectedBaseHash: baseHash } : {}), reason: file.reason, relatedDesignNodeIds: [] }; }), packageChanges: [], commandsRequested: [], assumptions: value.assumptions, unresolvedItems: value.unresolvedItems });
        validateProposedFileChanges(attemptProposal, root);
        // Coverage validation runs BEFORE the proposed-state build: an
        // uncovered proposal (e.g. one unrelated stylesheet for a whole
        // frame) must not cost a compile workspace or reach approval.
        validateImplementationCoverage(coveragePlan, attemptProposal, value.coverageClaims);
        // Proposed-state module validation: every changed executable module
        // must compile under the project's real build tooling in a temporary
        // workspace, even when nothing currently imports it. A latent
        // import/export defect is repairable model output, so it feeds the
        // same bounded regeneration loop instead of surviving to approval.
        const moduleValidation = await validateProposedModules(root, attemptProposal, { ...(project.commands.build !== undefined ? { buildCommand: { executable: project.commands.build.executable, args: project.commands.build.args ?? [] } } : {}), ...(context.signal !== undefined ? { signal: context.signal } : {}) });
        if (moduleValidation.status === "failed")
          throw new DesignFlowError("ERR_PROPOSAL_MODULE_COMPILE_FAILED", `A changed executable module in the proposal does not compile in the project context.`, { diagnostics: moduleValidation.diagnostics, validatedFiles: moduleValidation.validatedFiles });
      } catch (error) {
        const code = error instanceof DesignFlowError ? error.code : "ERR_PROPOSAL_INVALID";
        const failedPath = error instanceof DesignFlowError && typeof (error.metadata as Record<string, unknown> | undefined)?.path === "string" ? String((error.metadata as Record<string, unknown>).path) : /:\s*(\S+)$/.exec(error instanceof Error ? error.message : "")?.[1];
        const metadata = error instanceof DesignFlowError ? (error.metadata as Record<string, unknown> | undefined) : undefined;
        const diagnostics = Array.isArray(metadata?.diagnostics) ? (metadata.diagnostics as ProposedModuleDiagnostic[]) : undefined;
        failures.push({
          attempt,
          code,
          ...(failedPath !== undefined ? { path: failedPath } : {}),
          ...(diagnostics !== undefined ? { diagnostics } : {}),
          ...(typeof metadata?.targetId === "string" ? { targetId: metadata.targetId } : {}),
          ...(typeof metadata?.targetKind === "string" ? { targetKind: metadata.targetKind } : {}),
          ...(typeof metadata?.fact === "string" ? { fact: metadata.fact } : {}),
        });
        if (!REPAIRABLE_PROPOSAL_ERROR_CODES.has(code) || attempt === MAX_CORRECTION_PROPOSAL_ATTEMPTS) {
          throw new DesignFlowError(
            attempt === MAX_CORRECTION_PROPOSAL_ATTEMPTS && REPAIRABLE_PROPOSAL_ERROR_CODES.has(code) ? "ERR_PROPOSAL_ATTEMPTS_EXHAUSTED" : code,
            attempt === MAX_CORRECTION_PROPOSAL_ATTEMPTS && REPAIRABLE_PROPOSAL_ERROR_CODES.has(code)
              ? `The proposal remained invalid after ${MAX_CORRECTION_PROPOSAL_ATTEMPTS} bounded attempts; no approval was requested and no files were changed.`
              : (error instanceof Error ? error.message : String(error)),
            { attempts: attempt, attemptsExhausted: attempt === MAX_CORRECTION_PROPOSAL_ATTEMPTS, failures: failures.map((f) => ({ attempt: f.attempt, code: f.code, ...(f.path !== undefined ? { path: f.path } : {}) })) },
          );
        }
        repairFeedback = buildProposalRepairFeedback({ attempt, failures, project, root });
        continue;
      }
      return writeArtifact(context, { artifactId: IMPLEMENTATION_ARTIFACT_IDS.agentOutput, artifactType: IMPLEMENTATION_ARTIFACT_TYPES.agentOutput, name: "Implementation Agent output", payload: value, summary: { agentVersion: requested.implementationAgentVersion, modelProfileId: requested.implementationAgentModelProfileId, fileCount: value.files.length, proposalAttempts: attempt, ...(failures.length > 0 ? { failedAttempts: failures.map((f) => ({ attempt: f.attempt, code: f.code, ...(f.path !== undefined ? { path: f.path } : {}) })) } : {}) } });
    }
    throw new DesignFlowError("ERR_PROPOSAL_ATTEMPTS_EXHAUSTED", "Proposal attempts exhausted.", { attempts: MAX_CORRECTION_PROPOSAL_ATTEMPTS });
  } };
export const createImplementationPlanCapability: Capability<unknown, CapabilityOutput> = { id: "store-implementation-plan", name: "Store implementation plan", description: "Creates a structured implementation plan from specification, mapping, and agent output", type: "pure", version: "1", inputSchema: z.object({ agentVersion: z.string().min(1), modelProfileId: z.string().min(1) }).strict(), outputSchema: capabilityOutputSchema, async execute(context, input) { const requested = z.object({ agentVersion: z.string().min(1), modelProfileId: z.string().min(1) }).parse(input); const spec = await readArtifact(context, "design-specification", designSpecificationSchema); const mapping = await readArtifact(context, IMPLEMENTATION_ARTIFACT_IDS.mapping, designSystemMappingSchema); const project = await readArtifact(context, IMPLEMENTATION_ARTIFACT_IDS.projectContext, projectImplementationContextV1Schema); const agentOutput = await readArtifact(context, IMPLEMENTATION_ARTIFACT_IDS.agentOutput, generatedImplementationSchema); const plan = implementationPlanV1Schema.parse({ schemaVersion: "1", objective: `Implement ${spec.frames.join(", ") || "the selected design"} in the registered project.`, selectedNodeIds: spec.hierarchy.map((node) => node.id), targetRoute: project.structure.routeRoots[0], reuseComponents: mapping.componentMappings.filter((m) => m.action === "reuse").map((m) => m.projectComponentReference!), extendComponents: mapping.componentMappings.filter((m) => m.action === "extend").map((m) => m.projectComponentReference!), createComponents: agentOutput.files.filter((file) => file.action === "create").map((file) => file.path), reuseTokens: mapping.tokenMappings.filter((m) => m.action === "reuse").map((m) => m.projectTokenReference!), addTokens: mapping.tokenMappings.filter((m) => m.action === "create").map((m) => m.designTokenId), assets: spec.assets.map((a) => a.id), statePlan: spec.states, responsivePlan: spec.responsiveAssumptions, accessibilityPlan: spec.accessibilityNotes, proposedFileActions: agentOutput.files.map((file) => ({ path: file.path, action: file.action })), dependencyChanges: [], validationPlan: Object.keys(project.commands), assumptions: [...spec.ambiguities.map((a) => a.description), ...agentOutput.assumptions], unresolvedQuestions: [...mapping.unresolved.map((u) => u.description), ...agentOutput.unresolvedItems], agent: { id: "implementation-agent", version: requested.agentVersion, modelProfileId: requested.modelProfileId, schemaVersion: "1" } }); return writeArtifact(context, { artifactId: IMPLEMENTATION_ARTIFACT_IDS.plan, artifactType: IMPLEMENTATION_ARTIFACT_TYPES.plan, name: "Implementation Plan", payload: plan, summary: { componentCount: plan.createComponents.length + plan.reuseComponents.length } }); } };
export const createProposalCapability: Capability<unknown, CapabilityOutput> = { id: "store-proposed-file-changes", name: "Store proposed file changes", description: "Stores bounded, reviewable file proposals without writing files", type: "pure", version: "1", inputSchema: implementationWorkflowInputSchema, outputSchema: capabilityOutputSchema, async execute(context, input) { const requested = implementationWorkflowInputSchema.parse(input); const project = await readArtifact(context, IMPLEMENTATION_ARTIFACT_IDS.projectContext, projectImplementationContextV1Schema); const plan = await readArtifact(context, IMPLEMENTATION_ARTIFACT_IDS.plan, implementationPlanV1Schema); const agentOutput = await readArtifact(context, IMPLEMENTATION_ARTIFACT_IDS.agentOutput, generatedImplementationSchema); const outputByPath = new Map(agentOutput.files.map((file) => [file.path, file])); const root = requested.project.rootPath; if (root === undefined) throw new Error("A registered project root is required to validate the proposal."); const proposal = proposedFileChangesSchema.parse({ schemaVersion: "1", projectId: project.project.id, baseProjectFingerprint: project.project.contextFingerprint, files: plan.proposedFileActions.map((action) => { const file = outputByPath.get(action.path); const baseHash = action.action === "modify" ? projectFileHash(join(root, action.path)) : undefined; return { path: action.path, action: action.action, content: file?.content, ...(baseHash !== undefined ? { expectedBaseHash: baseHash } : {}), reason: file?.reason ?? "Implementation Agent proposal.", relatedDesignNodeIds: plan.selectedNodeIds }; }), packageChanges: [], commandsRequested: Object.values(project.commands).filter(Boolean).map((command) => ({ name: command!.name, required: command!.required })), assumptions: plan.assumptions, unresolvedItems: plan.unresolvedQuestions }); // Deterministic host validation BEFORE the approval prompt: operation
    // semantics (modify/delete target must exist, create must not), path
    // safety, and size bounds. An invalid proposal fails here with a typed
    // error instead of being presented for approval.
    validateProposedFileChanges(proposal, root);
    // Coverage validation of the EXACT stored proposal (same host-derived
    // plan, same claims from the persisted agent output), persisted as an
    // auditable artifact before any approval can exist.
    const storedSpec = await readArtifact(context, "design-specification", designSpecificationSchema);
    const storedMapping = await readArtifact(context, IMPLEMENTATION_ARTIFACT_IDS.mapping, designSystemMappingSchema);
    const coveragePlan = deriveImplementationCoveragePlan(storedSpec, storedMapping, project);
    const storedClaims = generatedImplementationSchema.parse(agentOutput).coverageClaims;
    const coverageResult = validateImplementationCoverage(coveragePlan, proposal, storedClaims);
    await writeArtifact(context, { artifactId: IMPLEMENTATION_ARTIFACT_IDS.coverage, artifactType: IMPLEMENTATION_ARTIFACT_TYPES.coverage, name: "Implementation Coverage", payload: { schemaVersion: "1", plan: coveragePlan, claims: storedClaims, result: coverageResult }, summary: { status: coverageResult.status, requiredTargets: coveragePlan.requiredTargets.length, satisfiedTargets: coverageResult.satisfiedTargets.length } });
    // Compile-validate the EXACT proposal that approval will bind to, in a
    // temporary workspace (the registered project is never mutated), and
    // record the result hash-bound to this proposal. Rendered reachability
    // is measured separately: an unreachable-but-valid module is trusted
    // evidence for the correction stage, never a failure by itself.
    const moduleValidation = await validateProposedModules(root, proposal, { ...(project.commands.build !== undefined ? { buildCommand: { executable: project.commands.build.executable, args: project.commands.build.args ?? [] } } : {}), ...(context.signal !== undefined ? { signal: context.signal } : {}) });
    if (moduleValidation.status === "failed") throw new DesignFlowError("ERR_PROPOSAL_MODULE_COMPILE_FAILED", "A changed executable module in the stored proposal does not compile in the project context; no approval will be requested.", { diagnostics: moduleValidation.diagnostics, validatedFiles: moduleValidation.validatedFiles });
    const renderReachability = analyzeRenderReachability(root, changedExecutableFiles(proposal));
    await writeArtifact(context, { artifactId: IMPLEMENTATION_ARTIFACT_IDS.moduleValidation, artifactType: IMPLEMENTATION_ARTIFACT_TYPES.moduleValidation, name: "Proposed Module Validation", payload: { schemaVersion: "1", status: moduleValidation.status, validatedFiles: moduleValidation.validatedFiles, diagnostics: moduleValidation.diagnostics, proposalHash: moduleValidation.proposalHash, ...(moduleValidation.command !== undefined ? { command: moduleValidation.command } : {}), ...(moduleValidation.durationMs !== undefined ? { durationMs: moduleValidation.durationMs } : {}), renderReachability }, summary: { status: moduleValidation.status, validatedFiles: moduleValidation.validatedFiles.length, proposalHash: moduleValidation.proposalHash, reachableChangedFiles: renderReachability.reachableChangedFiles, unreachableChangedFiles: renderReachability.unreachableChangedFiles } });
    // The compact coverage summary rides on the proposal artifact metadata
    // because the approval prompt reads exactly this artifact; the full
    // plan/claims/result stay in the implementation-coverage payload above.
    const coverageSummary = coveragePlan.requiredTargets.map((target) => { const satisfied = coverageResult.satisfiedTargets.find((entry) => entry.targetId === target.id); return { targetId: target.id, kind: target.kind, ...(target.name !== undefined ? { name: target.name } : {}), ...(satisfied !== undefined ? { mode: satisfied.mode, paths: satisfied.paths } : {}) }; });
    return writeArtifact(context, { artifactId: IMPLEMENTATION_ARTIFACT_IDS.proposal, artifactType: IMPLEMENTATION_ARTIFACT_TYPES.proposal, name: "Proposed File Changes", payload: proposal, summary: { createCount: proposal.files.filter((f) => f.action === "create").length, modifyCount: proposal.files.filter((f) => f.action === "modify").length, moduleValidation: moduleValidation.status, moduleValidationProposalHash: moduleValidation.proposalHash, coverageSummary } }); } };
export const implementationCapabilities: readonly Capability<unknown, CapabilityOutput>[] = [inspectRegisteredProjectCapability, mapDesignSystemCapability, invokeImplementationAgentStage4Capability, createImplementationPlanCapability, createProposalCapability];
