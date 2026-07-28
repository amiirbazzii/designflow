// apps/designflow-web/src/screens/ResultView.tsx
import type { ArtifactSummary, ExecutionReport } from "@designflow/product";

/**
 * The completion summary.
 *
 * Counts, timeline, artifacts and narration all come from
 * `WorkflowRunner.explain()`. Nothing is recomputed in the browser, so the
 * page cannot report a different result than the engine did.
 */
export function ResultView(props: {
  readonly report: ExecutionReport;
}): JSX.Element {
  const { overview, timeline, artifacts, narration } = props.report;
  const named = artifacts.filter(isNamed);
  const blobs = artifacts.length - named.length;

  return (
    <>
      <h2>
        {overview.state === "ready" ? "Workflow complete" : "Workflow stopped"}
      </h2>

      <div className="card">
        <p style={{ marginTop: 0 }}>{overview.summary}</p>

        <div className="counts">
          <span>
            <b>{overview.artifacts.created}</b>
            <span className="meta">Created</span>
          </span>
          <span>
            <b>{overview.artifacts.reused}</b>
            <span className="meta">Reused</span>
          </span>
          {overview.artifacts.removed > 0 && (
            <span>
              <b>{overview.artifacts.removed}</b>
              <span className="meta">Removed</span>
            </span>
          )}
        </div>

        {overview.durationLabel !== undefined && (
          <p className="meta">Took {overview.durationLabel}.</p>
        )}
      </div>

      {named.length > 0 && (
        <>
          <h2>Artifacts</h2>
          {named.map((artifact) => (
            <div className="card" key={artifact.artifactId}>
              <div className="row">
                <strong>{artifact.name}</strong>
                <span className="tag">{artifact.status}</span>
                {artifact.version !== undefined && (
                  <span className="tag">v{artifact.version}</span>
                )}
              </div>
              {artifact.createdBy !== undefined && (
                <p className="meta">Produced by {artifact.createdBy}</p>
              )}
              {artifact.dependencies.length > 0 && (
                <p className="meta">
                  Built from {artifact.dependencies.join(", ")}
                </p>
              )}
            </div>
          ))}
          {blobs > 0 && (
            // Each capability also registers a content-addressed payload. They
            // are counted rather than listed, so the totals still reconcile
            // with the engine's own count without filling the page with
            // hashes.
            <p className="meta">{blobs} stored payloads not listed.</p>
          )}
        </>
      )}

      <h2>Timeline</h2>
      <div className="card">
        <ul className="narration">
          {timeline.entries.map((entry, index) => (
            <li key={`${entry.timestamp}-${index}`}>
              <span className="time">{entry.at}</span>
              {entry.label}
            </li>
          ))}
        </ul>
      </div>

      <h2>What DesignFlow did</h2>
      <div className="card">
        <ul className="narration">
          {narration.map((entry, index) => (
            <li key={`${entry.timestamp}-${index}`}>{entry.message}</li>
          ))}
        </ul>
      </div>
    </>
  );
}

/**
 * A payload blob carries no name, so the product layer falls back to its
 * content hash. Those are storage detail rather than results.
 */
function isNamed(artifact: ArtifactSummary): boolean {
  return artifact.name !== artifact.artifactId;
}
