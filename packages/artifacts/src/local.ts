import { DesignFlowError, artifactRefSchema } from "@designflow/sdk";
import type { ArtifactRef, ArtifactLineage, ArtifactStore } from "@designflow/sdk";
import { ensureArtifactDir, readArtifact, writeArtifact } from "./storage";
import { ArtifactErrorCodes, ARTIFACTS_DIR } from "./types";

export class LocalArtifactStore implements ArtifactStore {
  private readonly basePath: string;

  public constructor(basePath?: string) {
    this.basePath = basePath ?? ARTIFACTS_DIR;
  }

  public async save(
    data: unknown,
    metadata?: Record<string, unknown>,
    lineage?: ArtifactLineage,
  ): Promise<ArtifactRef> {
    const id = await this.computeContentHash(data);
    const type = "artifact";
    const resolvedMetadata = metadata ?? {};

    const artifact: ArtifactRef = {
      id,
      type,
      metadata: resolvedMetadata,
      ...(lineage !== undefined ? { lineage } : {}),
    };

    await ensureArtifactDir(this.basePath);
    await writeArtifact(this.basePath, {
      id,
      type,
      metadata: resolvedMetadata,
      ...(lineage !== undefined ? { lineage } : {}),
      data,
    });

    return artifact;
  }

  public async get(
    id: string,
  ): Promise<{ artifact: ArtifactRef; data: unknown } | null> {
    const stored = await readArtifact(this.basePath, id);
    if (stored === null) return null;

    return {
      artifact: artifactRefSchema.parse({
        id: stored.id,
        type: stored.type,
        metadata: stored.metadata,
        ...(stored.lineage !== undefined ? { lineage: stored.lineage } : {}),
      }),
      data: stored.data,
    };
  }

  public async exists(id: string): Promise<boolean> {
    try {
      const path = `${this.basePath}/${id}.json`;
      const file = Bun.file(path);
      return await file.exists();
    } catch (error) {
      throw new DesignFlowError(
        ArtifactErrorCodes.EXISTS_FAILED,
        `Failed to check artifact existence: ${id}`,
        { id, error: String(error) },
      );
    }
  }

  private async computeContentHash(data: unknown): Promise<string> {
    try {
      const serialized = JSON.stringify(data);
      if (serialized === undefined) {
        throw new TypeError("Data cannot be serialized to JSON");
      }
      const encoder = new TextEncoder();
      const encoded = encoder.encode(serialized);
      // Internal content identifier implementation.
      // Public contracts remain algorithm-agnostic.
      const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    } catch (error) {
      throw new DesignFlowError(
        ArtifactErrorCodes.INVALID_DATA,
        "Failed to compute content hash",
        { error: String(error) },
      );
    }
  }
}
