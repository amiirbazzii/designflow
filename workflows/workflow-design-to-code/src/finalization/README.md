# Finalization (V2-7)

The final safety boundary:

```
Visual Convergence → selected proposal P*
  → authoritative binding verification
  → final review (a view of P*, exactly)
  → human approval (existing policy gate)
  → re-verification → snapshot → apply P* → required validation
  → typed finalization result
```

Core invariant, verified rather than assumed:

```
selected proposal = displayed proposal = approved proposal = applied proposal
```

## ADR — the nine commitments

1. **One authoritative binding verifier.** `verifyProjectProposalBinding` /
   `assertProjectProposalBinding` in the SDK owns project-identity,
   fingerprint, proposal-identity, approval-status/target/expiry semantics.
   The former four handwritten checks (`verifyApproval`, two side-effect
   inline checks, core's node-approval validation) are now call sites of it,
   with their pre-existing public error codes preserved through mapping.
   `canonicalProposalHash` is likewise the single proposal hash algorithm.
2. **The selected proposal from convergence is immutable.** V2-7 resolves
   `selectedProposalRef`, verifies its bytes hash to `selectedProposalHash`,
   and never chooses, regenerates or rebases a candidate.
3. **Displayed = approved = applied.** The review's file list is derived from
   the resolved proposal payload; approval binds its hash; the application
   result's recorded hash is verified equal before the final record is
   written. A later, regressed P2 can never ride along when P1 was selected.
4. **Approval binds the exact hash, project and fingerprint** — the existing
   `ImplementationApprovalBinding` plus the engine's node-approval binding,
   both unchanged in shape.
5. **Project drift invalidates approval and apply.** Checked at inspection,
   at approval construction, at resume, at snapshot and at apply — all
   through the one verifier. Drift is a first-class outcome
   (`project_changed`), never a silent rebase.
6. **Snapshot happens before writes.** The reused stage-4 order is
   verification → snapshot → apply; there is no path that writes first.
7. **Required validation happens after writes** with the project's own
   discovered checks; DesignFlow never asks a model whether apply succeeded.
8. **Rollback remains host-owned** — the existing snapshot/rollback
   machinery, reused unchanged.
9. **Zero AI calls.** Every step in this stage is identity, review,
   authority, snapshot, apply, validation. The test host wires no model, no
   critic, no builder.

## Files

- `finalization-types.ts` — input schema and payload resolution.
- `finalization-capabilities.ts` — inspect / resolve / review / result steps
  and `unappliedFinalizationResult` for pre-write terminal outcomes.
- `finalization-workflow.ts` — `design-to-code-v2-finalize` plus its
  approval policy (`approvalModes: ["manual"]` — human authority only).
- `finalization-report.ts` — the human-readable projection (not truth).

Still internal: `designflow run design-engineer` is unchanged (V2-8 owns
flagship routing), and no Coordinator dependency exists here.
