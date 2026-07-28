// apps/designflow-web/src/screens/RunningView.tsx
import type { ExecutionProgress, ExecutionStatus } from "@designflow/product";

/**
 * The progress checklist.
 *
 * Every step and its state comes from `WorkflowRunner.progress()`. The
 * component chooses glyphs; it does not decide what is done — there is no
 * local state machine here to fall out of step with the engine.
 */
export function RunningView(props: {
  readonly status: ExecutionStatus;
  readonly progress: ExecutionProgress;
}): JSX.Element {
  const { status, progress } = props;

  return (
    <>
      <h2>{status.workflowName}</h2>
      <div className="card">
        <div className="row">
          <span className="tag">{status.statusLabel}</span>
          <span className="meta">{status.message}</span>
        </div>

        <div className="bar">
          <div style={{ width: `${progress.percent}%` }} />
        </div>

        <ul className="steps">
          {progress.steps.map((step, index) => (
            <li key={`${step.label}-${index}`} className={step.status}>
              <span className="mark">
                {step.status === "done" ? "✓" : step.status === "active" ? "→" : "○"}
              </span>
              <span>{step.label}</span>
            </li>
          ))}
        </ul>

        <p className="meta">
          {progress.completed} of {progress.total} steps
        </p>
      </div>
    </>
  );
}
