// packages/agents/src/catalog/implementation-agent.ts
import {
  agentManifestSchema,
  designSpecificationSchema,
  generatedImplementationSchema,
  modelProfileSchema,
  projectImplementationContextSchema,
  type AgentInvocationRequest,
  type AgentManifest,
  type DesignSpecification,
  type GeneratedImplementation,
  type ModelProfile,
  type ProjectImplementationContext,
  projectImplementationContextV1Schema,
  type SpecializedAgent,
  type SpecializedAgentContext,
} from "@designflow/sdk";

import { SpecializedAgentOutputInvalidError } from "../errors";
import { implementationResponseSchema } from "../model-response-schemas";
import { generateValidatedModelOutput } from "../model-structured-output";

/**
 * The Implementation Agent.
 *
 * Consumes a Design Specification and a Project Implementation Context and
 * produces a Generated Implementation — structured, pseudo file proposals,
 * never a real write to a project. Nothing here touches a filesystem: the
 * "files" it proposes are string content stored as a DesignFlow artifact,
 * exactly like Stage 1's `generate-code` capability stored its own stub
 * files. A real write is explicitly a later stage's work.
 */

const MODEL_PROFILE_ID = "implementation-default";

export const implementationAgentManifest: AgentManifest = agentManifestSchema.parse({
  id: "implementation-agent",
  name: "Implementation Agent",
  description: "Turns a design specification and project context into a proposed implementation",
  version: "0.1.0",
  instructions:
    "Read the supplied design specification, bounded project implementation context, and optional design-system mapping. " +
    "Follow observed framework and conventions; prefer existing components and tokens only when confidence is sufficient. " +
    "Output only schema-valid structured proposals with reasons, assumptions, and unresolved questions. " +
    "Never invent packages, emit absolute or traversal paths, request shell execution, claim validation passed, or claim files were written. " +
    "Use action 'modify' only for a relative path listed in the project context's component sources or file evidence; any new file must use action 'create' with a project-relative path. " +
    "If the project context already lists a file at the exact target path, that path MUST use action 'modify', never 'create'. " +
    "Preserve accessibility and public APIs, and distinguish observed facts, inferred conventions, design facts, mapping decisions, and assumptions.",
  allowedWorkflows: ["design-to-code-agent-foundation", "design-to-code-implementation"],
  allowedTools: [],
  modelProfileId: MODEL_PROFILE_ID,
  metadata: { author: "DesignFlow" },
});

export const implementationDefaultModelProfile: ModelProfile = modelProfileSchema.parse({
  id: MODEL_PROFILE_ID,
  providerId: "openrouter",
  model: "openai/gpt-4o-mini",
});

interface ImplementationInput {
  readonly designSpecification: DesignSpecification;
  readonly projectContext: ProjectImplementationContext;
  readonly designSystemMapping?: unknown;
}

export type ImplementationStrategy = (
  request: AgentInvocationRequest,
  context: SpecializedAgentContext,
  manifest: AgentManifest,
) => Promise<GeneratedImplementation>;

function readInput(request: AgentInvocationRequest): ImplementationInput {
  const raw = request.input as Partial<ImplementationInput> | undefined;

  const spec = designSpecificationSchema.safeParse(raw?.designSpecification);
  const project = projectImplementationContextSchema.safeParse(raw?.projectContext);
  const stage4Project = projectImplementationContextV1Schema.safeParse(raw?.projectContext);

  if (!spec.success || (!project.success && !stage4Project.success)) {
    throw new SpecializedAgentOutputInvalidError("implementation-agent", [
      "input must carry a valid designSpecification and projectContext",
    ]);
  }

  if (project.success) return { designSpecification: spec.data, projectContext: project.data, designSystemMapping: raw?.designSystemMapping };
  if (!stage4Project.success) throw new SpecializedAgentOutputInvalidError("implementation-agent", ["project context could not be normalized"]);
  const context = stage4Project.data;
  return {
    designSpecification: spec.data,
    designSystemMapping: raw?.designSystemMapping,
    projectContext: {
      schemaVersion: context.schemaVersion,
      projectId: context.project.id,
      projectRootIdentity: context.project.rootIdentity,
      framework: context.runtime.framework,
      sourceRoot: context.structure.sourceRoots[0] ?? "src",
      stylingStrategy: context.styling.primaryStrategy ?? context.styling.strategies[0] ?? "unknown",
      existingComponentReferences: context.designSystem.components.map((component) => component.name),
      designSystemReferences: context.designSystem.tokens.map((token) => token.reference),
      ...(context.commands.test !== undefined ? { testCommand: `${context.commands.test.executable} ${context.commands.test.args.join(" ")}` } : {}),
      ...(context.commands.build !== undefined ? { buildCommand: `${context.commands.build.executable} ${context.commands.build.args.join(" ")}` } : {}),
      contextFingerprint: context.project.contextFingerprint,
    },
  };
}

function validate(implementationVersion: string, raw: unknown): GeneratedImplementation {
  const withVersion =
    typeof raw === "object" && raw !== null ? { ...raw, implementationVersion } : raw;
  const parsed = generatedImplementationSchema.safeParse(withVersion);

  if (!parsed.success) {
    throw new SpecializedAgentOutputInvalidError(
      "implementation-agent",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }

  return parsed.data;
}

function extensionFor(framework: string): string {
  return framework === "react" ? "tsx" : framework === "vue" ? "vue" : "svelte";
}

function componentIdentifier(name: string): string {
  const compact = name.replace(/[^A-Za-z0-9_$]+(.)?/g, (_match, next: string | undefined) => next?.toUpperCase() ?? "");
  return /^[A-Za-z_$]/.test(compact) ? compact : `Component${compact}`;
}

function componentContent(name: string, role: string, framework: string): string {
  const identifier = componentIdentifier(name);
  const escapedName = JSON.stringify(name);
  if (framework === "react") {
    return [
      `// Generated by the Implementation Agent`,
      `// Role: ${role}`,
      `export function ${identifier}() {`,
      `  return <div data-designflow-component={${escapedName}} aria-label={${escapedName}} />;`,
      `}`,
      ``,
    ].join("\n");
  }
  if (framework === "vue") {
    return [
      `<!-- Generated by the Implementation Agent -->`,
      `<template><div data-designflow-component="${name}" aria-label="${name}" /></template>`,
      `<script setup lang="ts"></script>`,
      ``,
    ].join("\n");
  }
  return [
    `<!-- Generated by the Implementation Agent -->`,
    `<div data-designflow-component="${name}" aria-label="${name}"></div>`,
    ``,
  ].join("\n");
}

export const deterministicImplementationStrategy: ImplementationStrategy = async (
  request,
  _context,
  manifest,
) => {
  const { designSpecification, projectContext } = readInput(request);
  const extension = extensionFor(projectContext.framework);

  const reused = designSpecification.components.filter((component) =>
    projectContext.existingComponentReferences.includes(component.name),
  );
  const toCreate = designSpecification.components.filter(
    (component) => !projectContext.existingComponentReferences.includes(component.name),
  );

  const files = toCreate.map((component) => ({
    path: `${projectContext.sourceRoot}/${componentIdentifier(component.name)}.${extension}`,
    action: "create" as const,
    content: componentContent(component.name, component.role, projectContext.framework),
    reason: `Realizes the "${component.name}" component from the design specification.`,
  }));

  return validate(manifest.version, {
    files,
    assumptions: [
      `Styling strategy assumed: ${projectContext.stylingStrategy}`,
      ...(reused.length > 0
        ? [`Reused existing project components: ${reused.map((component) => component.name).join(", ")}`]
        : []),
    ],
    unresolvedItems: designSpecification.ambiguities.map((ambiguity) => ambiguity.description),
  });
};

export const modelImplementationStrategy: ImplementationStrategy = async (
  request,
  context,
  manifest,
) => {
  const { designSpecification, projectContext, designSystemMapping } = readInput(request);

  return generateValidatedModelOutput({
    agentId: "implementation-agent",
    context,
    messages: [
      { role: "system", content: manifest.instructions },
      {
        role: "user",
        content:
          `Objective: ${request.objective}\n\n` +
          `Design specification:\n${JSON.stringify(designSpecification)}\n\n` +
          `Project context:\n${JSON.stringify(projectContext)}` +
          `\n\nDesign-system mapping:\n${JSON.stringify(designSystemMapping ?? null)}`,
      },
    ],
    responseSchema: implementationResponseSchema,
    maxOutputTokens: 1600,
    validate: (output) => validate(manifest.version, output),
  });
};

class ImplementationAgent implements SpecializedAgent {
  public readonly manifest: AgentManifest;
  private readonly strategy: ImplementationStrategy;

  public constructor(manifest: AgentManifest, strategy: ImplementationStrategy) {
    this.manifest = manifest;
    this.strategy = strategy;
  }

  public perform(
    request: AgentInvocationRequest,
    context: SpecializedAgentContext,
  ): Promise<GeneratedImplementation> {
    return this.strategy(request, context, this.manifest);
  }
}

export function createImplementationAgent(
  strategy: ImplementationStrategy = deterministicImplementationStrategy,
): SpecializedAgent {
  return new ImplementationAgent(implementationAgentManifest, strategy);
}

export const implementationAgent: SpecializedAgent = createImplementationAgent();
