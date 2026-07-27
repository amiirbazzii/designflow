// packages/core/src/artifacts/hashing.ts
import { DesignFlowError } from "@designflow/sdk";
import { canonicalize } from "./immutability";

async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Content identifier for an arbitrary value, stable across key ordering.
 *
 * The single hashing implementation in core: artifact version hashes and
 * capability input fingerprints must agree on what "same content" means, so
 * they share this function rather than each rolling their own. The algorithm
 * stays internal — public contracts expose an opaque `string`.
 */
export async function hashContent(value: unknown): Promise<string> {
  const serialized = JSON.stringify(canonicalize(value));

  if (serialized === undefined) {
    throw new DesignFlowError(
      "ERR_ARTIFACT_INVALID_DATA",
      "Value cannot be serialized for hashing",
      { valueType: typeof value },
    );
  }

  return sha256Hex(serialized);
}
