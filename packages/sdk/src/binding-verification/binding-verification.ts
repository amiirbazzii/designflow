// packages/sdk/src/binding-verification/binding-verification.ts
import { sha256Hex } from "./sha256";

/**
 * The one authoritative project/proposal/approval binding verifier (V2-7).
 *
 * Before this existed, the same safety question — "is the thing about to be
 * written the exact thing that was planned, reviewed and approved, against the
 * exact project state it was planned for?" — was answered by four handwritten
 * comparisons in three packages, each with its own error behavior. Four copies
 * of a load-bearing check is four places for the fifth copy to quietly differ.
 *
 * This module owns the semantics. Callers describe what they expected and what
 * they found; the verifier answers with a typed outcome. It never touches the
 * filesystem, never hashes anything a caller did not hand it, and never maps
 * its codes to a caller's public error vocabulary — compatibility mapping is
 * the call site's job, so old public codes stay stable.
 *
 * Check order is deliberate and fixed: approval authority first (a check that
 * cannot pass makes the rest moot), then approval target, then expiry, then
 * project identity, proposal binding, and finally project drift — so a caller
 * always gets the most fundamental failure, deterministically.
 */

export type BindingVerificationCode =
  | "ERR_APPROVAL_NOT_GRANTED"
  | "ERR_APPROVAL_TARGET_MISMATCH"
  | "ERR_APPROVAL_EXPIRED"
  | "ERR_PROJECT_BINDING_MISMATCH"
  | "ERR_PROPOSAL_BINDING_MISMATCH"
  | "ERR_PROJECT_CHANGED";

export interface ApprovalBindingFacts {
  /** Approval lifecycle status; anything but `approved`/`granted` refuses. */
  readonly status?: string;
  readonly expiresAt?: string;
  /** The proposal identity the approval was granted for. */
  readonly proposalArtifactId?: string;
  readonly proposalHash?: string;
  readonly projectId?: string;
  readonly baseProjectFingerprint?: string;
}

export interface BindingVerificationInput {
  readonly expectedProjectId?: string;
  readonly actualProjectId?: string;
  /** The fingerprint the proposal/plan was bound to. */
  readonly expectedProjectFingerprint?: string;
  /** The fingerprint the project has right now. */
  readonly actualProjectFingerprint?: string;
  readonly expectedProposalArtifactId?: string;
  readonly actualProposalArtifactId?: string;
  readonly expectedProposalHash?: string;
  readonly actualProposalHash?: string;
  /** When present, the approval must be granted, unexpired, and bound to the expected identities. */
  readonly approval?: ApprovalBindingFacts;
  readonly now?: Date;
}

export type BindingVerificationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: BindingVerificationCode; readonly message: string };

const APPROVED_STATUSES: readonly string[] = ["approved", "granted"];

function mismatch(code: BindingVerificationCode, message: string): BindingVerificationResult {
  return { ok: false, code, message };
}

function differs(expected: string | undefined, actual: string | undefined): boolean {
  return expected !== undefined && actual !== undefined && expected !== actual;
}

/** The single semantic comparison every binding gate must go through. */
export function verifyProjectProposalBinding(input: BindingVerificationInput): BindingVerificationResult {
  const approval = input.approval;

  if (approval !== undefined) {
    if (approval.status !== undefined && !APPROVED_STATUSES.includes(approval.status))
      return mismatch("ERR_APPROVAL_NOT_GRANTED", "The proposal has not been approved.");

    if (
      differs(input.expectedProposalArtifactId, approval.proposalArtifactId) ||
      differs(input.expectedProposalHash, approval.proposalHash) ||
      differs(input.expectedProjectId, approval.projectId) ||
      differs(input.expectedProjectFingerprint, approval.baseProjectFingerprint)
    )
      return mismatch(
        "ERR_APPROVAL_TARGET_MISMATCH",
        "The approval was granted for a different proposal or project state.",
      );

    if (approval.expiresAt !== undefined) {
      const now = input.now ?? new Date();
      const expiry = new Date(approval.expiresAt).getTime();
      if (Number.isFinite(expiry) && expiry <= now.getTime())
        return mismatch("ERR_APPROVAL_EXPIRED", "The approval has expired.");
    }
  }

  if (differs(input.expectedProjectId, input.actualProjectId))
    return mismatch("ERR_PROJECT_BINDING_MISMATCH", "The proposal is bound to a different registered project.");

  if (
    differs(input.expectedProposalArtifactId, input.actualProposalArtifactId) ||
    differs(input.expectedProposalHash, input.actualProposalHash)
  )
    return mismatch(
      "ERR_PROPOSAL_BINDING_MISMATCH",
      "The proposal is not the exact proposal this operation was bound to.",
    );

  if (differs(input.expectedProjectFingerprint, input.actualProjectFingerprint))
    return mismatch(
      "ERR_PROJECT_CHANGED",
      "The project changed after the proposal was created. Generate a new proposal before continuing.",
    );

  return { ok: true };
}

/**
 * Verifies and throws the caller's own error on failure.
 *
 * `mapError` exists for exactly one reason: pre-existing public error codes
 * (`ERR_APPROVAL_MISMATCH`, `ERR_PROJECT_FINGERPRINT_CHANGED`, core's
 * `ApprovalError` prose) must not churn just because the check moved. New code
 * uses the verifier's own vocabulary.
 */
export function assertProjectProposalBinding(
  input: BindingVerificationInput,
  mapError?: (code: BindingVerificationCode, message: string) => Error,
): void {
  const result = verifyProjectProposalBinding(input);
  if (result.ok) return;
  if (mapError !== undefined) throw mapError(result.code, result.message);
  throw new BindingVerificationError(result.code, result.message);
}

export class BindingVerificationError extends Error {
  public readonly code: BindingVerificationCode;
  public constructor(code: BindingVerificationCode, message: string) {
    super(message);
    this.name = "BindingVerificationError";
    this.code = code;
  }
}

/**
 * The one canonical proposal hash.
 *
 * sha256 over the JSON serialization of the value as handed in — exactly the
 * algorithm every existing site already used independently. It lives here so
 * "the proposal hash" can only ever mean one thing; no new site may inline
 * `createHash("sha256").update(JSON.stringify(...))` for a proposal again.
 */
export function canonicalProposalHash(value: unknown): string {
  return sha256Hex(JSON.stringify(value));
}
