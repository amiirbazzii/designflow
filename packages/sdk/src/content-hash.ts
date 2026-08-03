// packages/sdk/src/content-hash.ts

/**
 * A stable content fingerprint, independent of key ordering.
 *
 * Exists in `sdk` rather than only in `core` because product-layer code
 * (assembling a project's context into a reuse fingerprint, for instance)
 * needs the same "same content, same hash" guarantee without depending on
 * the engine. `core` keeps its own copy for artifact versioning and
 * capability input fingerprints — the algorithm is intentionally identical,
 * but the two are not required to share an implementation to agree with each
 * other, since neither ever compares a hash produced by one against a hash
 * produced by the other.
 */
export async function hashContent(value: unknown): Promise<string> {
  const serialized = JSON.stringify(canonicalize(value));
  const encoded = new TextEncoder().encode(serialized);
  const digest = await crypto.subtle.digest("SHA-256", encoded);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (isRecord(value)) {
    const ordered: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      ordered[key] = canonicalize(value[key]);
    }
    return ordered;
  }

  return value;
}
