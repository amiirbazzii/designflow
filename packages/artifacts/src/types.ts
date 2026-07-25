export const ARTIFACTS_DIR = ".designflow/artifacts";

export interface StoredArtifact {
  id: string;
  type: string;
  metadata: Record<string, unknown>;
  data: unknown;
}

export const ArtifactErrorCodes = {
  SAVE_FAILED: "ERR_ARTIFACT_SAVE",
  READ_FAILED: "ERR_ARTIFACT_READ",
  EXISTS_FAILED: "ERR_ARTIFACT_EXISTS",
  INVALID_DATA: "ERR_ARTIFACT_INVALID_DATA",
  DIRECTORY_FAILED: "ERR_ARTIFACT_DIRECTORY",
  INVALID_ID: "ERR_ARTIFACT_INVALID_ID",
} as const;
