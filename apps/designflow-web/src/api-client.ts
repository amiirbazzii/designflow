// apps/designflow-web/src/api-client.ts
import { z } from "zod";
import {
  approvalOutcomeSchema,
  executionHandleSchema,
  executionProgressSchema,
  executionReportSchema,
  executionStatusSchema,
  workflowHistoryEntrySchema,
} from "@designflow/product";
import type {
  ApprovalOutcome,
  ExecutionHandle,
  ExecutionProgress,
  ExecutionReport,
  ExecutionStatus,
  WorkflowHistoryEntry,
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

const workflowSummarySchema = z.object({
  workflowId: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  steps: z.array(z.string().min(1)),
});

export type WorkflowSummary = z.infer<typeof workflowSummarySchema>;

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
