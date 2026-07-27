import {
  artifactMaterializationRequestSchema,
  artifactMaterializationResultSchema,
  executionEventSchema,
} from "@designflow/sdk";
import type {
  ArtifactMaterializationRequest,
  ArtifactMaterializationResult,
  ArtifactMaterializer,
  ArtifactRegistry,
  ExecutionEventPublisher,
} from "@designflow/sdk";
import { ArtifactMaterializationError } from "../errors";
import type { MaterializationIssue, MaterializedArtifact } from "./validation";
import { checkArtifact, resolveSourceExecutionId } from "./validation";

export interface RegistryArtifactMaterializerOptions {
  readonly registry: ArtifactRegistry;
  /**
   * Receives `artifact.materialized`, one event per artifact, published only
   * after the whole set has been validated.
   */
  readonly eventPublisher?: ExecutionEventPublisher | undefined;
}

/**
 * Materializes claimed artifact ids against an `ArtifactRegistry`.
 *
 * Strictly read-only: it resolves identity and version records and builds
 * references from them. It never executes a capability, creates an artifact,
 * or mutates the registry.
 *
 * Validation is all-or-nothing. A single bad id fails the whole request and no
 * event is published, so a partially valid reuse decision leaves no trace —
 * the same rule the reuse boundary already follows.
 */
export class RegistryArtifactMaterializer implements ArtifactMaterializer {
  private readonly registry: ArtifactRegistry;
  private readonly eventPublisher: ExecutionEventPublisher | undefined;

  public constructor(options: RegistryArtifactMaterializerOptions) {
    this.registry = options.registry;
    this.eventPublisher = options.eventPublisher;
  }

  public async materialize(
    request: ArtifactMaterializationRequest,
  ): Promise<ArtifactMaterializationResult> {
    const validated = artifactMaterializationRequestSchema.parse(request);

    const materialized: MaterializedArtifact[] = [];
    const issues: MaterializationIssue[] = [];

    for (const artifactId of validated.artifactIds) {
      const check = await checkArtifact(this.registry, artifactId);

      if (check.ok) {
        materialized.push(check.value);
      } else {
        issues.push(check.issue);
      }
    }

    if (issues.length > 0) {
      throw new ArtifactMaterializationError(
        `Cannot materialize ${issues.length} of ${validated.artifactIds.length} artifact(s)`,
        {
          nodeId: validated.nodeId,
          capabilityId: validated.capabilityId,
          executionId: validated.executionId,
          issues,
        },
      );
    }

    const sourceExecutionId = resolveSourceExecutionId(materialized);

    for (const item of materialized) {
      await this.publish(validated, item.ref.id, item.sourceExecutionId);
    }

    return artifactMaterializationResultSchema.parse({
      success: true,
      artifacts: materialized.map((item) => item.ref),
      ...(sourceExecutionId !== undefined ? { sourceExecutionId } : {}),
    });
  }

  private async publish(
    request: ArtifactMaterializationRequest,
    artifactId: string,
    sourceExecutionId: string | undefined,
  ): Promise<void> {
    if (this.eventPublisher === undefined) return;

    const event = executionEventSchema.parse({
      id: crypto.randomUUID(),
      executionId: request.executionId,
      type: "artifact.materialized",
      timestamp: Date.now(),
      payload: {
        nodeId: request.nodeId,
        artifactId,
        ...(sourceExecutionId !== undefined ? { sourceExecutionId } : {}),
      },
    });

    await this.eventPublisher.publish(event);
  }
}
