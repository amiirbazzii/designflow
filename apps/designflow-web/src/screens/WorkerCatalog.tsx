// apps/designflow-web/src/screens/WorkerCatalog.tsx
import type { WorkerSummary } from "../api-client";

/**
 * The Worker Task Boundary's catalogue view.
 *
 * Read-only, additive alongside the existing workflow-driven home screen —
 * this stage aligns the web app's vocabulary around Workers without
 * redesigning `InputForm`/`RunningView`/etc., which still speak workflows.
 * Every field comes from `WorkerSummary`, itself built from the same
 * `WorkerManifest` the CLI and API read — no worker id, category or
 * description is hand-duplicated here.
 */
export function WorkerCatalog({
  workers,
}: {
  readonly workers: readonly WorkerSummary[];
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
        </div>
      ))}
    </section>
  );
}
