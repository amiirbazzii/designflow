// packages/core/src/materialization/validation.ts
import { artifactRefSchema } from "@designflow/sdk";
import type { ArtifactRef, ArtifactRegistry } from "@designflow/sdk";

// ── Issues ──────────────────────────────────────────────────────

export const MATERIALIZATION_ISSUE_KINDS = [
  /** The id names nothing in the registry. */
  "unknown_artifact",
  /** The artifact exists but the version it points at cannot be resolved. */
  "missing_version",
  /** The reconstructed reference does not satisfy `artifactRefSchema`. */
  "corrupt_reference",
] as const;

export type MaterializationIssueKind =
  (typeof MATERIALIZATION_ISSUE_KINDS)[number];

export interface MaterializationIssue {
  readonly artifactId: string;
  readonly kind: MaterializationIssueKind;
  readonly detail: string;
}

// ── Checked Artifact ────────────────────────────────────────────

export interface MaterializedArtifact {
  readonly ref: ArtifactRef;
  readonly version: number;
  readonly sourceExecutionId: string | undefined;
}

export type MaterializationCheck =
  | { readonly ok: true; readonly value: MaterializedArtifact }
  | { readonly ok: false; readonly issue: MaterializationIssue };

// ── Rules ───────────────────────────────────────────────────────

/**
 * Resolves one claimed artifact id against the registry.
 *
 * Read-only by construction: it queries identity and version records and
 * builds a reference from them. Nothing is created, and no registry state is
 * touched.
 *
 * The three rejection rules are applied in order — an id that names nothing
 * cannot have a version, and a version that cannot be resolved makes the
 * reference meaningless.
 */
export async function checkArtifact(
  registry: ArtifactRegistry,
  artifactId: string,
): Promise<MaterializationCheck> {
  const artifact = await registry.getArtifact(artifactId);

  if (artifact === null) {
    return {
      ok: false,
      issue: {
        artifactId,
        kind: "unknown_artifact",
        detail: "No artifact is registered under this id",
      },
    };
  }

  // The artifact header points at its latest version. A registry that cannot
  // produce that record is inconsistent, and a reference built from it would
  // claim a revision that does not exist.
  const version = await registry.getVersion(artifactId, artifact.version);

  if (version === null) {
    return {
      ok: false,
      issue: {
        artifactId,
        kind: "missing_version",
        detail: `Artifact points at version ${artifact.version}, which has no record`,
      },
    };
  }

  const parsed = artifactRefSchema.safeParse({
    id: artifact.id,
    type: artifact.type,
    metadata: artifact.metadata,
  });

  if (!parsed.success) {
    return {
      ok: false,
      issue: {
        artifactId,
        kind: "corrupt_reference",
        detail: parsed.error.message,
      },
    };
  }

  return {
    ok: true,
    value: {
      ref: parsed.data,
      version: version.version,
      sourceExecutionId: artifact.provenance?.executionId,
    },
  };
}

/**
 * The execution every materialized artifact came from, when they agree.
 *
 * Returns undefined when the set spans several runs or any artifact carries no
 * provenance — reporting one run's id for a mixed set would misattribute the
 * others.
 */
export function resolveSourceExecutionId(
  materialized: readonly MaterializedArtifact[],
): string | undefined {
  if (materialized.length === 0) return undefined;

  const first = materialized[0]?.sourceExecutionId;
  if (first === undefined) return undefined;

  return materialized.every((item) => item.sourceExecutionId === first)
    ? first
    : undefined;
}
