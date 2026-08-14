import { createHash } from "node:crypto";
import {
  assertProjectProposalBinding,
  canonicalProposalHash,
  implementationApprovalBindingSchema,
  type BindingVerificationCode,
  type ImplementationApprovalBinding,
  type ProposedFileChanges,
} from "@designflow/sdk";
import { ImplementationError } from "../errors";

/** The canonical proposal hash — one algorithm, owned by the SDK (V2-7). */
export function proposalHash(proposal: ProposedFileChanges): string { return canonicalProposalHash(proposal); }

export function createApprovalBinding(proposalArtifactId: string, proposal: ProposedFileChanges, now = new Date(), ttlMs = 30 * 60_000): ImplementationApprovalBinding { return implementationApprovalBindingSchema.parse({ approvalId: createHash("sha256").update(`${proposalArtifactId}:${proposalHash(proposal)}`).digest("hex").slice(0, 24), proposalArtifactId, proposalHash: proposalHash(proposal), projectId: proposal.projectId, baseProjectFingerprint: proposal.baseProjectFingerprint, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + ttlMs).toISOString(), status: "pending" }); }

/** This module's pre-existing public error codes, preserved through mapping. */
function publicError(code: BindingVerificationCode): ImplementationError {
  switch (code) {
    case "ERR_APPROVAL_NOT_GRANTED":
      return new ImplementationError("ERR_APPROVAL_MISMATCH", "The implementation proposal has not been approved.");
    case "ERR_APPROVAL_EXPIRED":
      return new ImplementationError("ERR_APPROVAL_EXPIRED", "Implementation approval has expired.");
    case "ERR_PROJECT_CHANGED":
      return new ImplementationError("ERR_PROJECT_FINGERPRINT_CHANGED", "The project changed after the proposal was created. Generate a new proposal before continuing.");
    default:
      return new ImplementationError("ERR_APPROVAL_MISMATCH", "Approval no longer matches the proposed implementation.");
  }
}

/**
 * The full approval gate, routed through the one authoritative verifier
 * (`verifyProjectProposalBinding`, V2-7) rather than a local comparison.
 */
export function verifyApproval(binding: ImplementationApprovalBinding, proposalArtifactId: string, proposal: ProposedFileChanges, currentProjectFingerprint: string, now = new Date()): void {
  assertProjectProposalBinding(
    {
      expectedProjectId: proposal.projectId,
      expectedProjectFingerprint: proposal.baseProjectFingerprint,
      actualProjectFingerprint: currentProjectFingerprint,
      expectedProposalArtifactId: proposalArtifactId,
      expectedProposalHash: proposalHash(proposal),
      approval: {
        status: binding.status,
        proposalArtifactId: binding.proposalArtifactId,
        proposalHash: binding.proposalHash,
        projectId: binding.projectId,
        baseProjectFingerprint: binding.baseProjectFingerprint,
        ...(binding.expiresAt !== undefined ? { expiresAt: binding.expiresAt } : {}),
      },
      now,
    },
    publicError,
  );
}
