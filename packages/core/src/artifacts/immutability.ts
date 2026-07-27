/**
 * Structural helpers shared by the artifact registry.
 *
 * Two guarantees rest on these: nothing handed out of the registry can be
 * mutated back into it (`deepFreeze` + `clone`), and a version hash depends
 * only on content, never on key insertion order (`canonicalize`).
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Recursively freezes plain objects and arrays; leaves primitives alone. */
export function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    Object.freeze(value);
    for (const item of items) {
      deepFreeze(item);
    }
    return value;
  }

  if (isRecord(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze(value[key]);
    }
  }

  return value;
}

/** Detaches a value from its caller so later mutation cannot reach the store. */
export function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * Rewrites a value with object keys in sorted order so that two structurally
 * equal values serialize identically.
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    return items.map(canonicalize);
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
