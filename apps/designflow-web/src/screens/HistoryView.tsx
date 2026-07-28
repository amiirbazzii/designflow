// apps/designflow-web/src/screens/HistoryView.tsx
import type { WorkflowHistoryEntry } from "@designflow/product";

/**
 * Previous runs.
 *
 * The reason persistence exists: this list is populated from SQLite, so it is
 * still here after the server restarts.
 */
export function HistoryView(props: {
  readonly history: readonly WorkflowHistoryEntry[];
  readonly onOpen: (executionId: string) => void;
}): JSX.Element {
  if (props.history.length === 0) {
    return (
      <>
        <h2>Previous runs</h2>
        <p className="meta">Nothing has run yet.</p>
      </>
    );
  }

  return (
    <>
      <h2>Previous runs</h2>
      {props.history.map((entry) => (
        <div className="card" key={entry.executionId}>
          <div className="row">
            <strong>{entry.workflowName}</strong>
            <span className="tag">{entry.status}</span>
            <span className="meta">{formatWhen(entry.startedAt)}</span>
          </div>
          <p className="meta">{entry.summary}</p>
          <a className="link" onClick={() => props.onOpen(entry.executionId)}>
            View run
          </a>
        </div>
      ))}
    </>
  );
}

/** "Today 09:14" for a recent run, a date for anything older. */
function formatWhen(timestamp: number): string {
  const when = new Date(timestamp);
  const today = new Date();

  const sameDay =
    when.getFullYear() === today.getFullYear() &&
    when.getMonth() === today.getMonth() &&
    when.getDate() === today.getDate();

  const time = when.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

  return sameDay ? `Today ${time}` : when.toLocaleDateString();
}
