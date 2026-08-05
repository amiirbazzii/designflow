// packages/core/src/composition/workflow-composition-executor.ts
import {
  DesignFlowError,
  executionEventSchema,
  withExecutionLineage,
  workflowInvocationContextSchema,
  workflowInvocationResultSchema,
  workflowInvocationSchema,
  type ArtifactRef,
  type ExecutionErrorDetail,
  type ExecutionEvent,
  type ExecutionEventPublisher,
  type WorkflowExecutionResolver,
  type WorkflowInvocationStatus,
  type WorkflowNode,
} from "@designflow/sdk";

import {
  WorkflowCompositionCycleError,
  WorkflowCompositionError,
} from "../errors";

// ── Request / Outcome ──────────────────────────────────────────────

export interface WorkflowCompositionRequest {
  readonly node: WorkflowNode;
  /** Node input already resolved against the parent's workflow input. */
  readonly input: unknown;
  readonly parentExecutionId: string;
  readonly parentWorkflowId: string;
  /** Ancestor workflow ids, root first. Empty for a root execution. */
  readonly compositionPath: readonly string[];
  /** Parent execution metadata propagated to the child invocation. */
  readonly metadata: Readonly<Record<string, unknown>>;
  /** The parent execution's abort signal, forwarded so cancellation reaches the child. */
  readonly signal?: AbortSignal;
}

export interface WorkflowCompositionOutcome {
  readonly status: WorkflowInvocationStatus;
  readonly childWorkflowId: string;
  readonly childExecutionId: string;
  readonly artifacts: readonly ArtifactRef[];
  readonly error: ExecutionErrorDetail | undefined;
}

// ── Executor ───────────────────────────────────────────────────────

/**
 * Executes a child workflow node on behalf of the parent DAG.
 *
 * Owns cycle protection, child lifecycle events and result normalization.
 * It never resolves workflow packages itself — that is delegated entirely to
 * the injected `WorkflowExecutionResolver`.
 */
export class WorkflowCompositionExecutor {
  private readonly resolver: WorkflowExecutionResolver;
  private readonly eventPublisher: ExecutionEventPublisher;

  public constructor(
    resolver: WorkflowExecutionResolver,
    eventPublisher: ExecutionEventPublisher,
  ) {
    this.resolver = resolver;
    this.eventPublisher = eventPublisher;
  }

  public async execute(
    request: WorkflowCompositionRequest,
  ): Promise<WorkflowCompositionOutcome> {
    const childWorkflowId = request.node.workflowId;
    const parentNodeId = request.node.id;

    const parentPath = this.buildParentPath(
      request.compositionPath,
      request.parentWorkflowId,
    );

    if (parentPath.includes(childWorkflowId)) {
      throw new WorkflowCompositionCycleError(
        childWorkflowId,
        [...parentPath, childWorkflowId],
        {
          parentExecutionId: request.parentExecutionId,
          parentWorkflowId: request.parentWorkflowId,
          parentNodeId,
        },
      );
    }

    const childPath = [...parentPath, childWorkflowId];

    const lineagePayload = {
      parentExecutionId: request.parentExecutionId,
      parentWorkflowId: request.parentWorkflowId,
      parentNodeId,
      childWorkflowId,
    };

    await this.publish(
      request.parentExecutionId,
      "workflow.child_started",
      lineagePayload,
    );

    const invocation = workflowInvocationSchema.parse({
      workflowId: childWorkflowId,
      input: request.input,
      metadata: request.metadata,
    });

    const invocationContext = workflowInvocationContextSchema.parse({
      parentExecutionId: request.parentExecutionId,
      parentWorkflowId: request.parentWorkflowId,
      parentNodeId,
      metadata: withExecutionLineage(request.metadata, {
        parentExecutionId: request.parentExecutionId,
        parentWorkflowId: request.parentWorkflowId,
        parentNodeId,
        compositionPath: childPath,
      }),
    });

    let result;
    try {
      const raw = await this.resolver.executeWorkflow(
        invocation,
        invocationContext,
        request.signal !== undefined ? { signal: request.signal } : undefined,
      );
      result = workflowInvocationResultSchema.parse(raw);
    } catch (error) {
      await this.publish(request.parentExecutionId, "workflow.child_failed", {
        ...lineagePayload,
        error: error instanceof Error ? error.message : String(error),
      });

      throw error instanceof DesignFlowError
        ? error
        : new WorkflowCompositionError(
            `Child workflow execution failed: ${childWorkflowId}`,
            {
              ...lineagePayload,
              cause: error instanceof Error ? error.message : String(error),
            },
          );
    }

    const outcome: WorkflowCompositionOutcome = {
      status: result.status,
      childWorkflowId: result.workflowId,
      childExecutionId: result.executionId,
      artifacts: result.artifacts,
      error: result.error,
    };

    await this.publishOutcome(request.parentExecutionId, {
      ...lineagePayload,
      childExecutionId: result.executionId,
    }, outcome);

    return outcome;
  }

  /**
   * The parent workflow always belongs on the path it hands to its children.
   * A root execution starts with an empty path, so it is appended here.
   */
  private buildParentPath(
    compositionPath: readonly string[],
    parentWorkflowId: string,
  ): readonly string[] {
    return compositionPath.includes(parentWorkflowId)
      ? [...compositionPath]
      : [...compositionPath, parentWorkflowId];
  }

  private async publishOutcome(
    parentExecutionId: string,
    payload: Record<string, unknown>,
    outcome: WorkflowCompositionOutcome,
  ): Promise<void> {
    switch (outcome.status) {
      case "completed":
        await this.publish(parentExecutionId, "workflow.child_completed", {
          ...payload,
          artifactCount: outcome.artifacts.length,
        });
        return;

      case "failed":
      case "cancelled":
        await this.publish(parentExecutionId, "workflow.child_failed", {
          ...payload,
          status: outcome.status,
          error: outcome.error,
        });
        return;

      case "pending_approval":
        await this.publish(parentExecutionId, "execution.waiting_approval", {
          ...payload,
          reason: outcome.error?.message ?? "Child workflow awaiting approval",
        });
        return;
    }
  }

  private async publish(
    executionId: string,
    type: ExecutionEvent["type"],
    payload: Record<string, unknown>,
  ): Promise<void> {
    const event = executionEventSchema.parse({
      id: crypto.randomUUID(),
      executionId,
      type,
      timestamp: Date.now(),
      payload,
    });
    await this.eventPublisher.publish(event);
  }
}
