import {
  executionRequestSchema,
  executionResultSchema,
  executionCheckpointSchema,
} from "@designflow/sdk";
import type {
  ExecutionRequest,
  ExecutionResult,
  ExecutionContract,
  WorkflowPackage,
  Logger,
  StateStore,
  ArtifactStore,
  ArtifactRef,
} from "@designflow/sdk";
import { DesignFlowError } from "@designflow/sdk";
import { CapabilityRegistry } from "../registry";
import { ExecutionEngine } from "../engine";

// ── Errors ──────────────────────────────────────────────────────

export class WorkflowNotFoundError extends DesignFlowError {
  public constructor(workflowId: string) {
    super(
      "ERR_WORKFLOW_NOT_FOUND",
      `Workflow not found: ${workflowId}`,
      { workflowId },
    );
    this.name = "WorkflowNotFoundError";
    Object.setPrototypeOf(this, WorkflowNotFoundError.prototype);
  }
}

export class InvalidRequestError extends DesignFlowError {
  public constructor(message: string, metadata?: Record<string, unknown>) {
    super("ERR_INVALID_REQUEST", message, metadata);
    this.name = "InvalidRequestError";
    Object.setPrototypeOf(this, InvalidRequestError.prototype);
  }
}

// ── Types ───────────────────────────────────────────────────────

export type WorkflowResolver = (workflowId: string) => WorkflowPackage | undefined;

export interface ExecutionServiceConfig {
  readonly workflowResolver: WorkflowResolver;
  readonly capabilityRegistry: CapabilityRegistry;
  readonly logger: Logger;
  readonly stateStore: StateStore;
  readonly artifactStore: ArtifactStore;
}

// ── Execution Service ───────────────────────────────────────────

export class ExecutionService implements ExecutionContract {
  private readonly workflowResolver: WorkflowResolver;
  private readonly capabilityRegistry: CapabilityRegistry;
  private readonly logger: Logger;
  private readonly stateStore: StateStore;
  private readonly artifactStore: ArtifactStore;

  public constructor(config: ExecutionServiceConfig) {
    this.workflowResolver = config.workflowResolver;
    this.capabilityRegistry = config.capabilityRegistry;
    this.logger = config.logger;
    this.stateStore = config.stateStore;
    this.artifactStore = config.artifactStore;
  }

  public async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const validatedRequest = this.validateRequest(request);

    if (validatedRequest.options?.resume) {
      return this.resume(validatedRequest.workflowId);
    }

    const workflowPackage = this.resolveWorkflow(validatedRequest.workflowId);

    const engine = new ExecutionEngine(
      this.capabilityRegistry,
      this.logger,
      this.artifactStore,
      this.stateStore,
    );

    const abortController = new AbortController();

    const executionContext = {
      runId: crypto.randomUUID(),
      workflowId: validatedRequest.workflowId,
      stateRef: "initial",
      artifacts: [],
      metadata: validatedRequest.metadata ?? {},
      signal: abortController.signal,
    };

    const engineResult = await engine.run(
      workflowPackage.definition,
      executionContext,
    );

    return this.normalizeResult(
      executionContext.runId,
      validatedRequest.workflowId,
      engineResult,
    );
  }

  public async resume(workflowId: string): Promise<ExecutionResult> {
    const workflowPackage = this.resolveWorkflow(workflowId);

    const latest = await this.stateStore.getLatestCheckpoint(workflowId);

    let executionId: string;
    if (latest !== null) {
      const checkpoint = executionCheckpointSchema.parse(latest.state);
      executionId = checkpoint.executionId;
    } else {
      executionId = crypto.randomUUID();
    }

    const engine = new ExecutionEngine(
      this.capabilityRegistry,
      this.logger,
      this.artifactStore,
      this.stateStore,
    );

    const engineResult = await engine.resume(workflowPackage.definition, workflowId);

    return this.normalizeResult(
      executionId,
      workflowId,
      engineResult,
    );
  }

  private validateRequest(request: ExecutionRequest): ExecutionRequest {
    const result = executionRequestSchema.safeParse(request);

    if (!result.success) {
      throw new InvalidRequestError(
        `Invalid execution request: ${result.error.message}`,
        {
          issues: result.error.issues,
          request,
        },
      );
    }

    return result.data;
  }

  private resolveWorkflow(workflowId: string): WorkflowPackage {
    const workflowPackage = this.workflowResolver(workflowId);

    if (!workflowPackage) {
      throw new WorkflowNotFoundError(workflowId);
    }

    return workflowPackage;
  }

  private normalizeResult(
    executionId: string,
    workflowId: string,
    engineResult: { success: boolean; artifacts: readonly ArtifactRef[]; error: unknown },
  ): ExecutionResult {
    const status = engineResult.success ? "completed" as const : "failed" as const;

    const error = engineResult.error !== undefined
      ? {
          code: engineResult.error instanceof Error
            ? engineResult.error.name
            : "UNKNOWN_ERROR",
          message: engineResult.error instanceof Error
            ? engineResult.error.message
            : String(engineResult.error),
        }
      : undefined;

    const result: ExecutionResult = {
      executionId,
      workflowId,
      status,
      artifacts: engineResult.artifacts.map((a) => ({
        id: a.id,
        type: a.type,
        metadata: a.metadata ?? {},
      })),
      error,
    };

    return executionResultSchema.parse(result);
  }
}
