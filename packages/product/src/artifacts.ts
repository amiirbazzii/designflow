import { artifactSummarySchema } from "./schemas";
import type { ArtifactStatus, ArtifactSummary } from "./schemas";
import type { Artifact, ArtifactRegistry, ExecutionEvent } from "@designflow/sdk";

/**
 * How each artifact an execution touched came to be in its final state.
 *
 * Read from the event stream rather than the registry, because the registry
 * records what an artifact *is*, not what this particular run did with it.
 * `removed` comes from the reconciliation report, which is the only place a
 * departure is recorded at all.
 */
export function classifyArtifacts(
  events: readonly ExecutionEvent[],
): ReadonlyMap<string, ArtifactStatus> {
  const statuses = new Map<string, ArtifactStatus>();

  for (const event of events) {
    const artifactId = event.payload?.artifactId;
    if (typeof artifactId !== "string" || artifactId.length === 0) continue;

    if (event.type === "artifact.reused") {
      // Reuse is the stronger statement: an artifact registered earlier in
      // this run and then adopted by a later node was still not recomputed.
      statuses.set(artifactId, "reused");
      continue;
    }

    if (event.type === "artifact.created" && !statuses.has(artifactId)) {
      statuses.set(artifactId, "created");
    }
  }

  return statuses;
}

/** A display name, preferring what the producer supplied. */
function nameOf(artifact: Artifact): string {
  const name = artifact.metadata.name;
  return typeof name === "string" && name.length > 0 ? name : artifact.id;
}

/**
 * Builds the presentation model for one artifact.
 *
 * Dependencies are the artifact's lineage ancestors, shown by display name so
 * a reader sees "UI Schema" rather than a content hash.
 */
async function summarize(
  registry: ArtifactRegistry,
  artifactId: string,
  status: ArtifactStatus,
): Promise<ArtifactSummary | null> {
  const artifact = await registry.getArtifact(artifactId);
  if (artifact === null) return null;

  const lineage = await registry.getLineage(artifactId);
  const byId = new Map(lineage.nodes.map((node) => [node.id, node]));

  const dependencies: string[] = [];
  for (const ancestorId of lineage.ancestors) {
    const ancestor = byId.get(ancestorId);
    dependencies.push(ancestor !== undefined ? nameOf(ancestor) : ancestorId);
  }

  return artifactSummarySchema.parse({
    artifactId: artifact.id,
    name: nameOf(artifact),
    type: artifact.type,
    version: artifact.version,
    status,
    ...(artifact.provenance?.capabilityId !== undefined
      ? { createdBy: artifact.provenance.capabilityId }
      : {}),
    dependencies,
  });
}

/**
 * Presentation models for every artifact an execution touched.
 *
 * Removed artifacts are reported from the reconciliation event even though
 * they are absent from the final set — a reader asking "what changed?" needs
 * to see what left, and the registry alone cannot say.
 */
export async function summarizeArtifacts(
  registry: ArtifactRegistry,
  events: readonly ExecutionEvent[],
): Promise<readonly ArtifactSummary[]> {
  const statuses = classifyArtifacts(events);
  const summaries: ArtifactSummary[] = [];

  for (const [artifactId, status] of statuses) {
    const summary = await summarize(registry, artifactId, status);
    if (summary !== null) summaries.push(summary);
  }

  for (const artifactId of readRemovedArtifactIds(events)) {
    if (statuses.has(artifactId)) continue;

    const summary = await summarize(registry, artifactId, "removed");
    if (summary !== null) summaries.push(summary);
  }

  return summaries;
}

/** Ids the reconciliation step reported as no longer in the final set. */
function readRemovedArtifactIds(
  events: readonly ExecutionEvent[],
): readonly string[] {
  const removed: string[] = [];

  for (const event of events) {
    if (event.type !== "execution.reconciled") continue;

    const ids = event.payload?.removedArtifactIds;
    if (!Array.isArray(ids)) continue;

    for (const id of ids) {
      if (typeof id === "string" && id.length > 0) removed.push(id);
    }
  }

  return removed;
}
