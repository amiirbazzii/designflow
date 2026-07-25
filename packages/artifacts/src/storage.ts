import { join } from "node:path";
import { mkdir, rename } from "node:fs/promises";
import { DesignFlowError } from "@designflow/sdk";
import type { StoredArtifact } from "./types";
import { ArtifactErrorCodes } from "./types";

function validateArtifactId(id: string): void {
  if (!id) {
    throw new DesignFlowError(
      ArtifactErrorCodes.INVALID_ID,
      "Artifact ID must not be empty",
    );
  }
  if (id.includes("..")) {
    throw new DesignFlowError(
      ArtifactErrorCodes.INVALID_ID,
      "Artifact ID must not contain path traversal sequences",
      { id },
    );
  }
  if (id.includes("/") || id.includes("\\")) {
    throw new DesignFlowError(
      ArtifactErrorCodes.INVALID_ID,
      "Artifact ID must not contain path separators",
      { id },
    );
  }
}

export function artifactPath(basePath: string, id: string): string {
  validateArtifactId(id);
  return join(basePath, `${id}.json`);
}

export async function ensureArtifactDir(basePath: string): Promise<void> {
  try {
    await mkdir(basePath, { recursive: true });
  } catch (error) {
    throw new DesignFlowError(
      ArtifactErrorCodes.DIRECTORY_FAILED,
      "Failed to create artifact directory",
      { basePath, error: String(error) },
    );
  }
}

export async function readArtifact(
  basePath: string,
  id: string,
): Promise<StoredArtifact | null> {
  try {
    const path = artifactPath(basePath, id);
    const file = Bun.file(path);
    const exists = await file.exists();
    if (!exists) return null;
    return (await file.json()) as StoredArtifact;
  } catch (error) {
    if (error instanceof DesignFlowError) throw error;
    throw new DesignFlowError(
      ArtifactErrorCodes.READ_FAILED,
      `Failed to read artifact: ${id}`,
      { id, error: String(error) },
    );
  }
}

export async function writeArtifact(
  basePath: string,
  artifact: StoredArtifact,
): Promise<void> {
  try {
    const path = artifactPath(basePath, artifact.id);
    const tmpPath = `${path}.tmp`;
    const data = JSON.stringify(artifact);
    await Bun.write(tmpPath, data);
    await rename(tmpPath, path);
  } catch (error) {
    throw new DesignFlowError(
      ArtifactErrorCodes.SAVE_FAILED,
      `Failed to save artifact: ${artifact.id}`,
      { id: artifact.id, error: String(error) },
    );
  }
}
