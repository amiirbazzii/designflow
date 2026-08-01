// apps/designflow-web/src/App.tsx
import { useCallback, useEffect, useState } from "react";
import type {
  ExecutionProgress,
  ExecutionReport,
  ExecutionStatus,
  WorkflowHistoryEntry,
} from "@designflow/product";
import { ApiError, api, type Session, type WorkerSummary } from "./api-client";
import { WorkerCatalog } from "./screens/WorkerCatalog";
import { InputForm } from "./screens/InputForm";
import { ClarificationView } from "./screens/ClarificationView";
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
 *
 * The primary submit/poll flow now speaks the Worker Task Boundary
 * (`/workers`, `/sessions`, `/results`) rather than `/api/workflows` +
 * `/api/executions/*`: a run starts as a session, which resolves to an
 * `executionId` once the agent decides to run a workflow. `Previous runs`
 * (`HistoryView`) is a separate, execution-only browsing feature that
 * predates sessions — it still opens an execution directly by id, which is
 * why it gets its own `"execution"` screen instead of reusing `"run"`.
 */

type Screen =
  | { readonly name: "home" }
  | { readonly name: "input"; readonly worker: WorkerSummary }
  | { readonly name: "run"; readonly sessionId: string }
  | { readonly name: "execution"; readonly executionId: string };

export function App(): JSX.Element {
  const [screen, setScreen] = useState<Screen>({ name: "home" });
  const [workers, setWorkers] = useState<readonly WorkerSummary[]>([]);
  const [history, setHistory] = useState<readonly WorkflowHistoryEntry[]>([]);
  const [session, setSession] = useState<Session | null>(null);
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
        setWorkers(await api.listWorkers());
      } catch (cause) {
        setError(messageOf(cause));
      }
    })();
    void refreshHistory();
  }, [refreshHistory]);

  /**
   * Pulls everything the `"execution"` screen shows, in one place — the
   * history browsing path, keyed directly by `executionId` and unrelated to
   * any session.
   */
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

  /**
   * Pulls everything the `"run"` screen shows, in one place — the session
   * this stage's migration built. While the session has not yet produced an
   * `executionId` (still `active`/`waiting_for_user`), only the session
   * itself is fetched. Once it has, `GET /results/:id` decides whether the
   * execution is still moving: a `ERR_WORKER_RESULT_NOT_READY` response means
   * "not finished yet", so status/progress (the only place that surfaces
   * approval detail and a step checklist — the Worker Task Boundary carries
   * neither) are fetched as a supplementary call, the same way `explain()`
   * supplements a finished result with the narration `WorkerResult` itself
   * does not carry.
   */
  const refreshRun = useCallback(async (sessionId: string) => {
    const nextSession = await api.getSession(sessionId);
    setSession(nextSession);

    const executionId = nextSession.executionId;

    if (executionId === undefined) {
      setStatus(null);
      setProgress(null);
      setReport(null);
      return;
    }

    try {
      await api.getWorkerResult(executionId);

      // The result exists, so the run has stopped moving.
      setStatus(null);
      setProgress(null);
      setReport(await api.explain(executionId));
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "ERR_WORKER_RESULT_NOT_READY") {
        const [nextStatus, nextProgress] = await Promise.all([
          api.status(executionId),
          api.progress(executionId),
        ]);

        setStatus(nextStatus);
        setProgress(nextProgress);
        setReport(null);
        return;
      }

      throw cause;
    }
  }, []);

  useEffect(() => {
    if (screen.name === "execution") {
      void loadExecution(screen.executionId).catch((cause: unknown) => {
        setError(messageOf(cause));
      });
      return;
    }

    if (screen.name === "run") {
      void refreshRun(screen.sessionId).catch((cause: unknown) => {
        setError(messageOf(cause));
      });
    }
  }, [screen, loadExecution, refreshRun]);

  const start = useCallback(
    async (worker: WorkerSummary, input: Record<string, unknown>) => {
      setBusy(true);
      setError(null);

      try {
        const nextSession = await api.startWorkerTask(
          worker.id,
          describeRequest(input),
          input,
        );

        setSession(nextSession);
        setStatus(null);
        setProgress(null);
        setReport(null);
        setScreen({ name: "run", sessionId: nextSession.id });
        await refreshHistory();
      } catch (cause) {
        setError(messageOf(cause));
      } finally {
        setBusy(false);
      }
    },
    [refreshHistory],
  );

  const answerClarification = useCallback(
    async (sessionId: string, answer: string) => {
      setBusy(true);
      setError(null);

      try {
        await api.answerSession(sessionId, answer);
        await refreshRun(sessionId);
      } catch (cause) {
        setError(messageOf(cause));
      } finally {
        setBusy(false);
      }
    },
    [refreshRun],
  );

  /**
   * Approve/reject still call the old `/api/executions/:id/approve|reject`
   * routes — the Worker Task Boundary has no approval route of its own yet —
   * but the `executionId` they need now comes from the resolved session (or,
   * for a run opened from history, from the execution id already in hand)
   * rather than from the retired `/api/workflows/:id/start` response.
   */
  const decide = useCallback(
    async (executionId: string, decision: "approve" | "reject", after: () => Promise<void>) => {
      setBusy(true);
      setError(null);

      try {
        await (decision === "approve"
          ? api.approve(executionId)
          : api.reject(executionId));

        await after();
        await refreshHistory();
      } catch (cause) {
        setError(messageOf(cause));
      } finally {
        setBusy(false);
      }
    },
    [refreshHistory],
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
          <WorkerCatalog
            workers={workers}
            onSelect={(worker) => setScreen({ name: "input", worker })}
          />

          <HistoryView
            history={history}
            onOpen={(executionId) => {
              setSession(null);
              setStatus(null);
              setProgress(null);
              setReport(null);
              setScreen({ name: "execution", executionId });
            }}
          />
        </>
      )}

      {screen.name === "input" && (
        <InputForm
          workflow={screen.worker}
          busy={busy}
          onCancel={() => setScreen({ name: "home" })}
          onSubmit={(input) => void start(screen.worker, input)}
        />
      )}

      {screen.name === "run" && (
        <>
          {session === null && <p className="meta">Loading…</p>}

          {session !== null &&
            session.status === "waiting_for_user" &&
            session.currentQuestion !== undefined && (
              <ClarificationView
                question={session.currentQuestion}
                busy={busy}
                onSubmit={(answer) => void answerClarification(screen.sessionId, answer)}
              />
            )}

          {session !== null && session.status === "declined" && (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Request declined</h2>
              <p className="meta">
                {session.declineReason ?? "The agent declined this request."}
              </p>
            </div>
          )}

          {session !== null &&
            (session.status === "failed" || session.status === "cancelled") &&
            session.executionId === undefined && (
              <div className="card err" role="alert">
                This request could not be completed.
              </div>
            )}

          {session !== null &&
            session.executionId !== undefined &&
            status !== null &&
            status.state === "needs_approval" &&
            status.approval !== undefined && (
              <ApprovalView
                approval={status.approval}
                busy={busy}
                onApprove={() =>
                  void decide(session.executionId as string, "approve", () =>
                    refreshRun(screen.sessionId),
                  )
                }
                onReject={() =>
                  void decide(session.executionId as string, "reject", () =>
                    refreshRun(screen.sessionId),
                  )
                }
              />
            )}

          {status !== null && progress !== null && (
            <RunningView status={status} progress={progress} />
          )}

          {report !== null && <ResultView report={report} />}

          <div className="row">
            <button onClick={() => setScreen({ name: "home" })}>
              Back to workflows
            </button>
            <button onClick={() => void refreshRun(screen.sessionId)}>
              Refresh
            </button>
          </div>
        </>
      )}

      {screen.name === "execution" && status !== null && (
        <>
          {status.state === "needs_approval" && status.approval !== undefined && (
            <ApprovalView
              approval={status.approval}
              busy={busy}
              onApprove={() =>
                void decide(screen.executionId, "approve", () =>
                  loadExecution(screen.executionId),
                )
              }
              onReject={() =>
                void decide(screen.executionId, "reject", () =>
                  loadExecution(screen.executionId),
                )
              }
            />
          )}

          {progress !== null && <RunningView status={status} progress={progress} />}

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

/**
 * Builds the `request` string `POST /workers/:workerId/tasks` requires from
 * the form's collected input fields — the same transformation
 * `apps/designflow-cli/src/commands/run.ts`'s `describeRequest` already
 * applies for the same API-equivalent call, mirrored here so the CLI and the
 * web app describe an identical submission the same way.
 */
function describeRequest(input: Record<string, unknown>): string {
  return Object.entries(input)
    .map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : value] as const)
    .filter(([, value]) => value !== undefined && value !== null && String(value).length > 0)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join("; ");
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
