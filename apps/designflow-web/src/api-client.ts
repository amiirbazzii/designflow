// apps/designflow-web/src/api-client.ts
import { z } from "zod";
import {
  approvalOutcomeSchema,
  executionHandleSchema,
  executionProgressSchema,
  executionReportSchema,
  executionStatusSchema,
  workflowHistoryEntrySchema,
  type ApprovalOutcome,
  type ExecutionHandle,
  type ExecutionProgress,
  type ExecutionReport,
  type ExecutionStatus,
  type WorkflowHistoryEntry,
} from "@designflow/product";

/**
 * The client's only connection to DesignFlow.
 *
 * Responses are parsed with the **product layer's own schemas**, so the wire
 * format cannot drift from the models the UI renders — a server change that
 * breaks the contract fails here, loudly, instead of rendering `undefined`
 * somewhere downstream. That is why this is a validated boundary rather than a
 * cast.
 *
 * The web app imports no engine package. Every call crosses HTTP to the API,
 * which is the only tier permitted to wire an implementation.
 */

/**
 * A worker as the Worker Task Boundary (`/workers`) returns it — never a
 * workflow id, an agent id or a model profile id. The schema is deliberately
 * narrower than the product layer's own `WorkerManifest`: a field this web
 * client does not render yet is a field it should not be validating either.
 */
const workerInputFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  placeholder: z.string().min(1),
  list: z.boolean().optional(),
  choices: z.array(z.string().min(1)).optional(),
});

const workflowSummarySchema = z.object({
  workflowId: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  steps: z.array(z.string().min(1)),
  /**
   * The owning worker's own input fields, forwarded by the API from
   * `WorkerManifest.inputs` — never a second, web-side list of fields kept
   * in sync by hand.
   */
  inputs: z.array(workerInputFieldSchema),
});

export type WorkflowSummary = z.infer<typeof workflowSummarySchema>;

const workerSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.string().min(1),
  inputs: z.array(workerInputFieldSchema),
});

export type WorkerSummary = z.infer<typeof workerSummarySchema>;

/**
 * A session as the Worker Task Boundary (`/sessions`) returns it — the
 * `toSafeSession()` shape the API actually sends (`apps/designflow-api/src/router.ts`),
 * agentId already stripped server-side. Deliberately narrower than the SDK's
 * `AgentSession`: only the fields this client renders or acts on (the pending
 * question, the decline reason, and the `executionId` a resolved decision
 * produces — the same id `/api/executions/:id` and its approve/reject routes
 * key on).
 */
const sessionSchema = z.object({
  id: z.string().min(1),
  workerId: z.string().min(1),
  status: z.enum([
    "active",
    "waiting_for_user",
    "completed",
    "declined",
    "failed",
    "cancelled",
  ]),
  currentQuestion: z.string().min(1).optional(),
  declineReason: z.string().min(1).optional(),
  /** The workflow execution this session produced, once one has started. */
  executionId: z.string().min(1).optional(),
});

export type Session = z.infer<typeof sessionSchema>;

/**
 * A result as the Worker Task Boundary (`/results`) returns it. Narrower than
 * the SDK's `WorkerResult`, the same "only what this client renders"
 * philosophy `workerSummarySchema` already documents — this client uses it
 * only to tell whether a run has finished, not to render outputs (the
 * existing `explain()`/`ExecutionReport` path still does that).
 */
const workerResultSchema = z.object({
  id: z.string().min(1),
  workerId: z.string().min(1),
  status: z.enum(["completed", "failed", "cancelled"]),
  summary: z.string(),
  executionId: z.string().min(1).optional(),
});

export type WorkerResult = z.infer<typeof workerResultSchema>;

export class ApiError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

const errorBodySchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }),
});

async function request<T>(
  path: string,
  key: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...init,
  });

  const body: unknown = await response.json();

  if (!response.ok) {
    const parsed = errorBodySchema.safeParse(body);

    throw parsed.success
      ? new ApiError(parsed.data.error.code, parsed.data.error.message)
      : new ApiError("ERR_UNKNOWN", `Request failed: ${response.status}`);
  }

  // Each payload is nested under a named key so a raw response reads clearly.
  // Unwrap first, then validate — a dynamic key in the object schema would
  // erase the parsed type.
  const envelope = z.record(z.string(), z.unknown()).parse(body);

  return schema.parse(envelope[key]);
}

export const api = {
  // ── The Worker Task Boundary (Stage 41) ────────────────────────
  listWorkers: (): Promise<readonly WorkerSummary[]> =>
    request("/workers", "workers", z.array(workerSummarySchema)),

  getWorker: (workerId: string): Promise<WorkerSummary> =>
    request(`/workers/${encodeURIComponent(workerId)}`, "worker", workerSummarySchema),

  /** Starts a session for a worker — the primary way a run begins now. */
  startWorkerTask: (
    workerId: string,
    requestText: string,
    input?: unknown,
    projectId?: string,
  ): Promise<Session> =>
    request(
      `/workers/${encodeURIComponent(workerId)}/tasks`,
      "session",
      sessionSchema,
      {
        method: "POST",
        body: JSON.stringify({
          request: requestText,
          ...(input !== undefined ? { input } : {}),
          ...(projectId !== undefined ? { projectId } : {}),
        }),
      },
    ),

  getSession: (sessionId: string): Promise<Session> =>
    request(`/sessions/${encodeURIComponent(sessionId)}`, "session", sessionSchema),

  answerSession: (
    sessionId: string,
    answer: string,
    idempotencyKey?: string,
  ): Promise<Session> =>
    request(
      `/sessions/${encodeURIComponent(sessionId)}/answers`,
      "session",
      sessionSchema,
      {
        method: "POST",
        body: JSON.stringify({
          answer,
          ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
        }),
      },
    ),

  getWorkerResult: (resultId: string): Promise<WorkerResult> =>
    request(`/results/${encodeURIComponent(resultId)}`, "result", workerResultSchema),

  // ── Deprecated: raw workflow-centric routes ─────────────────────
  // Retained for the existing screens below, which predate the Worker Task
  // Boundary. New UI should read through `listWorkers`/`getWorker` instead.
  listWorkflows: (): Promise<readonly WorkflowSummary[]> =>
    request("/api/workflows", "workflows", z.array(workflowSummarySchema)),

  start: (workflowId: string, input: unknown): Promise<ExecutionHandle> =>
    request(
      `/api/workflows/${encodeURIComponent(workflowId)}/start`,
      "execution",
      executionHandleSchema,
      { method: "POST", body: JSON.stringify({ input }) },
    ),

  status: (executionId: string): Promise<ExecutionStatus> =>
    request(
      `/api/executions/${encodeURIComponent(executionId)}`,
      "status",
      executionStatusSchema,
    ),

  progress: (executionId: string): Promise<ExecutionProgress> =>
    request(
      `/api/executions/${encodeURIComponent(executionId)}/progress`,
      "progress",
      executionProgressSchema,
    ),

  explain: (executionId: string): Promise<ExecutionReport> =>
    request(
      `/api/executions/${encodeURIComponent(executionId)}/explain`,
      "report",
      executionReportSchema,
    ),

  approve: (executionId: string, comment?: string): Promise<ApprovalOutcome> =>
    request(
      `/api/executions/${encodeURIComponent(executionId)}/approve`,
      "outcome",
      approvalOutcomeSchema,
      { method: "POST", body: JSON.stringify({ comment }) },
    ),

  reject: (executionId: string, comment?: string): Promise<ApprovalOutcome> =>
    request(
      `/api/executions/${encodeURIComponent(executionId)}/reject`,
      "outcome",
      approvalOutcomeSchema,
      { method: "POST", body: JSON.stringify({ comment }) },
    ),

  history: (workflowId?: string): Promise<readonly WorkflowHistoryEntry[]> =>
    request(
      workflowId !== undefined
        ? `/api/executions/history?workflowId=${encodeURIComponent(workflowId)}`
        : "/api/executions/history",
      "history",
      z.array(workflowHistoryEntrySchema),
    ),
};
