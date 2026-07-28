// apps/designflow-web/src/screens/ApprovalView.tsx
import type { PendingApproval } from "@designflow/product";

/**
 * The approval gate.
 *
 * Both buttons call the runner and nothing else — the decision is recorded and
 * acted on by the engine's own approval machinery, not by this component.
 */
export function ApprovalView(props: {
  readonly approval: PendingApproval;
  readonly busy: boolean;
  readonly onApprove: () => void;
  readonly onReject: () => void;
}): JSX.Element {
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Approval required</h2>
      <p>DesignFlow wants permission to:</p>
      <p>
        <strong>Generate production files</strong>
      </p>
      <p className="meta">{props.approval.reason}</p>

      <div className="row">
        <button className="primary" disabled={props.busy} onClick={props.onApprove}>
          Approve
        </button>
        <button className="danger" disabled={props.busy} onClick={props.onReject}>
          Reject
        </button>
      </div>
    </div>
  );
}
