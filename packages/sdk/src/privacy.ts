// packages/sdk/src/privacy.ts

/**
 * A shared "does this look like a secret" check.
 *
 * Project facts and agent memory are both durable and both, eventually, shown
 * back to a person — the same reason `project-summary`'s tool skips anything
 * named like a credential by filename. This is that same discipline, reused
 * wherever a fact or memory *value* (not just a filename) needs the same
 * refusal: a project fact or a memory entry is never a place to put an API
 * key, a token, or a password, so anything that looks like one is rejected at
 * the schema boundary rather than trusted to the caller's good judgement.
 *
 * Deliberately a heuristic, not a guarantee — the same honest limitation the
 * tool's own `SENSITIVE` pattern has. It catches the obvious cases; it is not
 * a secret scanner.
 */
const SECRET_LIKE_PATTERN =
  /secret|credential|password|api[-_]?key|access[-_]?token|bearer\s|private[-_]?key|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[a-zA-Z0-9]{10,}\b/i;

export function looksSecretLike(text: string): boolean {
  return SECRET_LIKE_PATTERN.test(text);
}

/** Applies `looksSecretLike` to an arbitrary value's key and serialised form. */
export function valueLooksSecretLike(key: string, value: unknown): boolean {
  if (looksSecretLike(key)) return true;

  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? "";
  } catch {
    return false;
  }

  return looksSecretLike(serialized);
}
