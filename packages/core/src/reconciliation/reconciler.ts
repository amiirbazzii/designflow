import {
  artifactReconciliationInputSchema,
  artifactReconciliationResultSchema,
  reconciliationReportSchema,
} from "@designflow/sdk";
import type {
  ArtifactReconciliationInput,
  ArtifactReconciliationResult,
  ArtifactRef,
  ArtifactRegistry,
  ExecutionReconciler,
  ReconciliationReport,
} from "@designflow/sdk";
import { ArtifactReconciliationError } from "../errors";
import type { ReconciliationConflict, VersionedArtifact } from "./comparison";
import {
  findContentConflicts,
  findSetConflicts,
  identityOf,
  resolveVersions,
} from "./comparison";

export interface ArtifactSetReconcilerOptions {
  /**
   * Source of truth for artifact versions. Reconciliation identity is
   * `id + version`, and a reference carries only the id half.
   */
  readonly registry: ArtifactRegistry;
}

/**
 * Merges an incremental run's reused and produced artifacts into its final
 * set, and reports what changed against the previous run.
 *
 * Read-only throughout: it resolves versions, compares, and counts. Nothing is
 * executed, decided or mutated.
 */
export class ArtifactSetReconciler implements ExecutionReconciler {
  private readonly registry: ArtifactRegistry;

  public constructor(options: ArtifactSetReconcilerOptions) {
    this.registry = options.registry;
  }

  public async reconcile(
    input: ArtifactReconciliationInput,
  ): Promise<ArtifactReconciliationResult> {
    const validated = artifactReconciliationInputSchema.parse(input);

    const previous = await resolveVersions(
      this.registry,
      validated.previousArtifacts,
    );
    const reused = await resolveVersions(
      this.registry,
      validated.reusedArtifacts,
    );
    const produced = await resolveVersions(
      this.registry,
      validated.producedArtifacts,
    );

    // The final set is what this run actually stands behind: everything it
    // adopted plus everything it made. A previous artifact that is in neither
    // was not carried forward, and is reported as removed.
    const merged = [...reused, ...produced];

    const conflicts: ReconciliationConflict[] = [
      ...findSetConflicts(merged),
      ...findContentConflicts(previous, produced),
    ];

    if (conflicts.length > 0) {
      throw new ArtifactReconciliationError(
        `Cannot reconcile execution ${validated.executionId}: ${conflicts.length} conflict(s)`,
        {
          executionId: validated.executionId,
          conflicts,
        },
      );
    }

    const resultIds = new Set(merged.map((artifact) => artifact.ref.id));

    const removedArtifactIds = unique(
      previous
        .filter((artifact) => !resultIds.has(artifact.ref.id))
        .map((artifact) => artifact.ref.id),
    );

    return artifactReconciliationResultSchema.parse({
      executionId: validated.executionId,
      // Stamped with the version each reference resolved to, so the run that
      // treats this set as its `previousArtifacts` compares against the
      // revisions this run actually settled on.
      artifacts: merged.map((artifact) => ({
        ...artifact.ref,
        version: artifact.version,
      })),
      reusedArtifactIds: unique(reused.map((artifact) => artifact.ref.id)),
      producedArtifactIds: unique(produced.map((artifact) => artifact.ref.id)),
      removedArtifactIds,
    });
  }

  public async createReport(
    previous: readonly ArtifactRef[],
    result: ArtifactReconciliationResult,
  ): Promise<ReconciliationReport> {
    const priorIdentities = new Set(
      (await resolveVersions(this.registry, previous)).map(identityOf),
    );

    const finalSet = await resolveVersions(this.registry, result.artifacts);
    const reusedIds = new Set(result.reusedArtifactIds);

    let added = 0;
    let reused = 0;
    let unchanged = 0;

    for (const artifact of finalSet) {
      // `reused` is checked first because it describes how the artifact
      // arrived, not whether the set changed. An adopted artifact is reused
      // whether or not the previous run happened to hold the same identity;
      // classifying it by the previous set would make the count depend on
      // history rather than on what this run did.
      if (reusedIds.has(artifact.ref.id)) {
        reused++;
        continue;
      }

      if (priorIdentities.has(identityOf(artifact))) {
        // Recomputed to the identity it already had.
        unchanged++;
      } else {
        // A new identity, whether the id is new or an existing one advanced.
        added++;
      }
    }

    return reconciliationReportSchema.parse({
      executionId: result.executionId,
      added,
      reused,
      removed: result.removedArtifactIds.length,
      unchanged,
    });
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
