import {
  executionRequestSchema,
  executionResultSchema,
  policyEvaluationResultSchema,
} from "@designflow/sdk";
import type {
  ExecutionRequest,
  ExecutionResult,
  ExecutionContract,
  WorkflowPackage,
  Logger,
  ArtifactStore,
  ArtifactRef,
  ExecutionRepository,
  ExecutionRecord,
  LifecycleEvent,
  ExecutionEventPublisher,
  ExecutionPolicy,
  PolicyEvaluator,
  PolicyContext,
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
  readonly artifactStore: ArtifactStore;
  readonly executionRepository: ExecutionRepository;
  readonly eventPublisher: ExecutionEventPublisher;
  readonly policyEvaluator?: PolicyEvaluator;
  readonly policy?: ExecutionPolicy;
}

// ── Execution Service ───────────────────────────────────────────

export class ExecutionService implements ExecutionContract {
  private readonly workflowResolver: WorkflowResolver;
  private readonly capabilityRegistry: CapabilityRegistry;
  private readonly logger: Logger;
  private readonly artifactStore: ArtifactStore;
  private readonly executionRepository: ExecutionRepository;
  private readonly eventPublisher: ExecutionEventPublisher;
  private readonly policyEvaluator: PolicyEvaluator | undefined;
  private readonly policy: ExecutionPolicy | undefined;

  public constructor(config: ExecutionServiceConfig) {
    this.workflowResolver = config.workflowResolver;
    this.capabilityRegistry = config.capabilityRegistry;
    this.logger = config.logger;
    this.artifactStore = config.artifactStore;
    this.executionRepository = config.executionRepository;
    this.eventPublisher = config.eventPublisher;
    this.policyEvaluator = config.policyEvaluator;
    this.policy = config.policy;
  }

  public async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const validatedRequest = this.validateRequest(request);

    if (validatedRequest.options?.resume) {
      return this.resume(validatedRequest.workflowId);
    }

    const workflowPackage = this.resolveWorkflow(validatedRequest.workflowId);

    const executionId = crypto.randomUUID();

    const now = Date.now();
    const record: ExecutionRecord = {
      executionId,
      workflowId: validatedRequest.workflowId,
      status: "running",
      startedAt: now,
      metadata: validatedRequest.metadata,
    };

    await this.executionRepository.create(record);
    await this.appendEvent(executionId, "created");

    try {
      if (this.policyEvaluator !== undefined && this.policy !== undefined) {
        const policyResult = await this.evaluatePolicy(
          workflowPackage,
          validatedRequest,
        );

        if (!policyResult.allowed) {
          await this.markFailed(
            executionId,
            validatedRequest.workflowId,
            new DesignFlowError(
              "ERR_POLICY_VIOLATION",
              "Execution denied by policy",
              {
                violations: policyResult.violations,
              },
            ),
          );

          await this.eventPublisher.publish({
            id: crypto.randomUUID(),
            executionId,
            type: "execution.failed",
            timestamp: Date.now(),
            payload: {
              workflowId: validatedRequest.workflowId,
              reason: "policy_violation",
              violations: policyResult.violations,
            },
          });

          const result: ExecutionResult = {
            executionId,
            workflowId: validatedRequest.workflowId,
            status: "failed",
            artifacts: [],
            error: {
              code: "ERR_POLICY_VIOLATION",
              message: `Execution denied: ${policyResult.violations.map((v) => v.message).join("; ")}`,
            },
          };
          return executionResultSchema.parse(result);
        }
      }

      const engine = new ExecutionEngine(
        this.capabilityRegistry,
        this.logger,
        this.artifactStore,
        this.executionRepository,
        this.eventPublisher,
      );

      const abortController = new AbortController();

      const executionContext = {
        runId: executionId,
        workflowId: validatedRequest.workflowId,
        stateRef: "initial",
        artifacts: [],
        metadata: validatedRequest.metadata ?? {},
        signal: abortController.signal,
      };

      await this.appendEvent(executionId, "executing");

      const engineResult = await engine.run(
        workflowPackage.definition,
        executionContext,
      );

      return this.finalizeResult(executionId, validatedRequest.workflowId, engineResult);
    } catch (error) {
      await this.markFailed(executionId, validatedRequest.workflowId, error);
      throw error;
    }
  }

  public async resume(workflowId: string): Promise<ExecutionResult> {
    const workflowPackage = this.resolveWorkflow(workflowId);

    const executionRecords = await this.executionRepository.list(workflowId);
    const latestRecord = this.findLatestRecord(executionRecords);

    if (latestRecord === null) {
      throw new DesignFlowError(
        "ERR_NO_CHECKPOINT",
        "No checkpoint found to resume from",
        { workflowId },
      );
    }

    switch (latestRecord.status) {
      case "completed": {
        const checkpoint = await this.executionRepository.getLatestCheckpoint(
          latestRecord.executionId,
        );

        const rawArtifacts = checkpoint?.metadata?.appliedArtifacts;
        const artifacts = Array.isArray(rawArtifacts)
          ? rawArtifacts.filter(
              (a): a is { id: string; type: string; metadata: Record<string, unknown> } =>
                typeof a === "object" &&
                a !== null &&
                "id" in a &&
                "type" in a,
            ).map((a) => ({
              id: a.id,
              type: a.type,
              metadata: a.metadata ?? {},
            }))
          : [];

        const result: ExecutionResult = {
          executionId: latestRecord.executionId,
          workflowId,
          status: "completed",
          artifacts,
        };
        return executionResultSchema.parse(result);
      }

      case "failed":
      case "cancelled": {
        const result: ExecutionResult = {
          executionId: latestRecord.executionId,
          workflowId,
          status: latestRecord.status,
          artifacts: [],
          error: {
            code: "WORKFLOW_PREVIOUSLY_TERMINATED",
            message: `Workflow previously ${latestRecord.status}, cannot resume`,
          },
        };
        return executionResultSchema.parse(result);
      }

      case "running": {
        const engine = new ExecutionEngine(
          this.capabilityRegistry,
          this.logger,
          this.artifactStore,
          this.executionRepository,
          this.eventPublisher,
        );

        await this.appendEvent(latestRecord.executionId, "executing");

        try {
          const engineResult = await engine.resume(
            workflowPackage.definition,
            workflowId,
            latestRecord.executionId,
          );

          return this.finalizeResult(
            latestRecord.executionId,
            workflowId,
            engineResult,
          );
        } catch (error) {
          await this.markFailed(latestRecord.executionId, workflowId, error);
          throw error;
        }
      }
    }
  }

  private async evaluatePolicy(
    workflowPackage: WorkflowPackage,
    request: ExecutionRequest,
  ): Promise<ReturnType<PolicyEvaluator["evaluate"]>> {
    const capabilityIds = workflowPackage.definition.nodes.map(
      (node) => node.capabilityId,
    );

    const context: PolicyContext = {
      workflowId: request.workflowId,
      capabilityIds,
      environment: request.metadata?.["environment"] as string | undefined,
      metadata: request.metadata,
    };

    return this.policyEvaluator!.evaluate(this.policy!, context);
  }

  private findLatestRecord(
    records: readonly ExecutionRecord[],
  ): ExecutionRecord | null {
    if (records.length === 0) return null;

    const sorted = [...records].sort(
      (a, b) => b.startedAt - a.startedAt,
    );

    return sorted[0] ?? null;
  }

  private async markFailed(
    executionId: string,
    workflowId: string,
    error: unknown,
  ): Promise<void> {
    const now = Date.now();

    try {
      await this.executionRepository.update(executionId, {
        status: "failed",
        completedAt: now,
      });

      await this.appendEvent(executionId, "failed");
    } catch (updateError) {
      this.logger.error("Failed to persist execution failure", {
        executionId,
        workflowId,
        originalError: String(error),
        updateError: String(updateError),
      });
    }
  }

  private async finalizeResult(
    executionId: string,
    workflowId: string,
    engineResult: { success: boolean; artifacts: readonly ArtifactRef[]; error: unknown },
  ): Promise<ExecutionResult> {
    const status = engineResult.success ? "completed" as const : "failed" as const;

    const now = Date.now();
    await this.executionRepository.update(executionId, {
      status,
      completedAt: now,
    });

    await this.appendEvent(
      executionId,
      engineResult.success ? "completed" : "failed",
    );

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

  private async appendEvent(
    executionId: string,
    phase: LifecycleEvent["phase"],
  ): Promise<void> {
    const event: LifecycleEvent = {
      executionId,
      phase,
      timestamp: Date.now(),
    };
    await this.executionRepository.appendEvent(event);
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
}
