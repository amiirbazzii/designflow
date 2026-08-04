// packages/product/src/artifact-inspection.ts
import type { ArtifactRegistry, ArtifactStore } from "@designflow/sdk";
import type { ArtifactSummary } from "./schemas";

/**
 * Reads back what a run actually produced or reused, for a person to inspect.
 *
 * A thin read boundary over the same registry and payload store the engine
 * already writes through — it holds no state of its own, and adds nothing to
 * what an artifact carries. Redaction happens here rather than at the CLI, so
 * every surface that shows an artifact's payload (the CLI today, an HTTP API
 * or a UI tomorrow) gets the same guarantee without having to remember to
 * apply it.
 */

const REDACTED = "[redacted]";

/** Field-name substrings that mark a value as never safe to display. */
const SENSITIVE_KEY_PATTERN =
  /(api[-_]?key|access[-_]?token|secret|password|credential|authorization|bearer)/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Replaces any value stored under a credential-shaped key with a fixed
 * placeholder, recursively.
 *
 * Conservative on purpose: a false positive (redacting something harmless
 * named, say, `secretSanta`) costs a reader nothing they could not ask for by
 * another name; a false negative could leak a real credential into a
 * terminal transcript or a saved trace.
 */
export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSensitive);
  }

  if (isPlainObject(value)) {
    const redacted: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      redacted[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? REDACTED
        : redactSensitive(entry);
    }
    return redacted;
  }

  return value;
}

export interface TruncatedText {
  readonly text: string;
  readonly truncated: boolean;
  readonly totalLength: number;
}

const DEFAULT_DISPLAY_LIMIT = 20_000;

/** Bounds display text to a reasonable terminal-friendly size. */
export function truncateForDisplay(
  text: string,
  limit: number = DEFAULT_DISPLAY_LIMIT,
): TruncatedText {
  if (text.length <= limit) {
    return { text, truncated: false, totalLength: text.length };
  }

  return {
    text: text.slice(0, limit),
    truncated: true,
    totalLength: text.length,
  };
}

export interface ArtifactDetail {
  readonly summary: ArtifactSummary;
  /** The redacted payload, or `undefined` when no payload could be recovered. */
  readonly payload: unknown;
}

export interface ArtifactInspectionServiceOptions {
  readonly artifactRegistry: ArtifactRegistry;
  readonly artifactStore: ArtifactStore;
}

/** Metadata key under which a logical artifact points at its stored payload. */
const PAYLOAD_ID_KEY = "payloadId";

export class ArtifactInspectionService {
  private readonly artifactRegistry: ArtifactRegistry;
  private readonly artifactStore: ArtifactStore;

  public constructor(options: ArtifactInspectionServiceOptions) {
    this.artifactRegistry = options.artifactRegistry;
    this.artifactStore = options.artifactStore;
  }

  /**
   * The redacted payload behind one artifact a report already named.
   *
   * Takes the summary the caller already resolved (from
   * `WorkflowRunner.explain`) rather than re-deriving it, so this can never
   * disagree with what a person was told the artifact is — it only adds the
   * payload underneath.
   *
   * Reads the *version record's* metadata, not the logical artifact's own —
   * an `Artifact`'s `metadata` is fixed at first registration and never
   * updated by a later revision (only its `version` pointer advances; see
   * `ArtifactRegistry.createVersion`), so it names the payload from the
   * artifact's very first version forever. The version record for the
   * artifact's current `version` number is what actually carries the current
   * payload id.
   */
  public async getPayload(summary: ArtifactSummary): Promise<ArtifactDetail> {
    const artifact = await this.artifactRegistry.getArtifact(summary.artifactId);
    if (artifact === null) return { summary, payload: undefined };

    const version = await this.artifactRegistry.getVersion(artifact.id, artifact.version);
    const payloadId = (version?.metadata ?? artifact.metadata)[PAYLOAD_ID_KEY];

    if (typeof payloadId !== "string" || payloadId.length === 0) {
      return { summary, payload: undefined };
    }

    const stored = await this.artifactStore.get(payloadId);
    if (stored === null) {
      return { summary, payload: undefined };
    }

    return { summary, payload: redactSensitive(stored.data) };
  }

  /**
   * Loads a payload by its stable logical artifact id for an internal workflow
   * handoff. The caller must already possess the artifact id; this method does
   * not discover or broaden artifact scope.
   */
  public async getPayloadByArtifactId(artifactId: string): Promise<unknown> {
    const artifact = await this.artifactRegistry.getArtifact(artifactId);
    if (artifact === null) return undefined;
    const version = await this.artifactRegistry.getVersion(artifact.id, artifact.version);
    const payloadId = (version?.metadata ?? artifact.metadata)[PAYLOAD_ID_KEY];
    if (typeof payloadId !== "string" || payloadId.length === 0) return undefined;
    const stored = await this.artifactStore.get(payloadId);
    return stored === null ? undefined : redactSensitive(stored.data);
  }
}
