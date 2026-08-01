// apps/designflow-web/src/screens/WorkerCatalog.tsx
import type { WorkerSummary } from "../api-client";

/**
 * The Worker Task Boundary's catalogue view.
 *
 * The home screen's entry point into a run: selecting a worker starts a
 * session for it (`POST /workers/:workerId/tasks`) by way of `InputForm`,
 * fed by that same worker's own `inputs`. This replaced the workflow-driven
 * list that used to lead into `InputForm` via `listWorkflows`/`start` — every
 * field here comes from `WorkerSummary`, itself built from the same
 * `WorkerManifest` the CLI and API read, no worker id, category or
 * description is hand-duplicated here.
 */
export function WorkerCatalog({
  workers,
  onSelect,
}: {
  readonly workers: readonly WorkerSummary[];
  readonly onSelect: (worker: WorkerSummary) => void;
}): JSX.Element {
  return (
    <section aria-label="AI workers">
      <h2>AI workers</h2>
      {workers.length === 0 && <p className="meta">No workers are installed.</p>}
      {workers.map((worker) => (
        <div className="card" key={worker.id}>
          <strong>{worker.name}</strong>
          <p className="meta">
            {worker.category} — {worker.description}
          </p>
          <button className="primary" onClick={() => onSelect(worker)}>
            Start
          </button>
        </div>
      ))}
    </section>
  );
}
