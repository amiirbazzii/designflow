// apps/designflow-web/src/App.tsx
import { useCallback, useEffect, useState } from "react";
import type {
  ExecutionProgress,
  ExecutionReport,
  ExecutionStatus,
  WorkflowHistoryEntry,
} from "@designflow/product";
import { api } from "./api-client";
import type { WorkerSummary, WorkflowSummary } from "./api-client";
import { WorkerCatalog } from "./screens/WorkerCatalog";
import { InputForm } from "./screens/InputForm";
import { RunningView } from "./screens/RunningView";
import { ApprovalView } from "./screens/ApprovalView";
import { ResultView } from "./screens/ResultView";
import { HistoryView } from "./screens/HistoryView";

/**
 * The MVP shell.
 *
 * A single component owning which screen is visible and the last data fetched
 * for it. No execution state is modelled here — `status.state` from the runner
 * decides what the user sees, so the UI cannot disagree with the engine about
 * whether a run is waiting, finished or failed.
 */

type Screen =
  | { readonly name: "home" }
  | { readonly name: "input"; readonly workflow: WorkflowSummary }
  | { readonly name: "run"; readonly executionId: string };

export function App(): JSX.Element {
  const [screen, setScreen] = useState<Screen>({ name: "home" });
  const [workflows, setWorkflows] = useState<readonly WorkflowSummary[]>([]);
  const [workers, setWorkers] = useState<readonly WorkerSummary[]>([]);
  const [history, setHistory] = useState<readonly WorkflowHistoryEntry[]>([]);
  const [status, setStatus] = useState<ExecutionStatus | null>(null);
  const [progress, setProgress] = useState<ExecutionProgress | null>(null);
  const [report, setReport] = useState<ExecutionReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await api.history());
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        setWorkflows(await api.listWorkflows());
      } catch (cause) {
        setError(messageOf(cause));
      }
    })();
    void (async () => {
      try {
        setWorkers(await api.listWorkers());
      } catch (cause) {
        setError(messageOf(cause));
      }
    })();
    void refreshHistory();
  }, [refreshHistory]);

  /** Pulls everything the run screen shows, in one place. */
  const loadExecution = useCallback(async (executionId: string) => {
    const [nextStatus, nextProgress] = await Promise.all([
      api.status(executionId),
      api.progress(executionId),
    ]);

    setStatus(nextStatus);
    setProgress(nextProgress);

    // The report is only meaningful once the run has stopped moving.
    setReport(
      nextStatus.state === "running" ? null : await api.explain(executionId),
    );
  }, []);

  useEffect(() => {
    if (screen.name !== "run") return;

    void loadExecution(screen.executionId).catch((cause: unknown) => {
      setError(messageOf(cause));
    });
  }, [screen, loadExecution]);

  const start = useCallback(
    async (workflowId: string, input: Record<string, unknown>) => {
      setBusy(true);
      setError(null);

      try {
        const handle = await api.start(workflowId, input);
        setScreen({ name: "run", executionId: handle.executionId });
        await refreshHistory();
      } catch (cause) {
        setError(messageOf(cause));
      } finally {
        setBusy(false);
      }
    },
    [refreshHistory],
  );

  const decide = useCallback(
    async (executionId: string, decision: "approve" | "reject") => {
      setBusy(true);
      setError(null);

      try {
        await (decision === "approve"
          ? api.approve(executionId)
          : api.reject(executionId));

        await loadExecution(executionId);
        await refreshHistory();
      } catch (cause) {
        setError(messageOf(cause));
      } finally {
        setBusy(false);
      }
    },
    [loadExecution, refreshHistory],
  );

  return (
    <div className="shell">
      <h1>DesignFlow</h1>
      <p className="lede">AI workflows that turn ideas into results.</p>

      {error !== null && (
        <div className="card err" role="alert">
          {error}
        </div>
      )}

      {screen.name === "home" && (
        <>
          <WorkerCatalog workers={workers} />

          <h2>Available workflows</h2>
          {workflows.length === 0 && (
            <p className="meta">No workflows are installed.</p>
          )}
          {workflows.map((workflow) => (
            <div className="card" key={workflow.workflowId}>
              <strong>{workflow.name}</strong>
              <p className="meta">{workflow.description}</p>
              <button
                className="primary"
                onClick={() => setScreen({ name: "input", workflow })}
              >
                Start workflow
              </button>
            </div>
          ))}

          <HistoryView
            history={history}
            onOpen={(executionId) => setScreen({ name: "run", executionId })}
          />
        </>
      )}

      {screen.name === "input" && (
        <InputForm
          workflow={screen.workflow}
          busy={busy}
          onCancel={() => setScreen({ name: "home" })}
          onSubmit={(input) => void start(screen.workflow.workflowId, input)}
        />
      )}

      {screen.name === "run" && status !== null && (
        <>
          {status.state === "needs_approval" && status.approval !== undefined && (
            <ApprovalView
              approval={status.approval}
              busy={busy}
              onApprove={() => void decide(screen.executionId, "approve")}
              onReject={() => void decide(screen.executionId, "reject")}
            />
          )}

          {progress !== null && (
            <RunningView status={status} progress={progress} />
          )}

          {report !== null && <ResultView report={report} />}

          <div className="row">
            <button onClick={() => setScreen({ name: "home" })}>
              Back to workflows
            </button>
            <button onClick={() => void loadExecution(screen.executionId)}>
              Refresh
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
