// packages/core/src/service/execution-service.ts
import { createHash } from "node:crypto";
import {
  executionRequestSchema,
  executionResultSchema,
  executionPolicySchema,
  childExecutionRequestSchema,
  isCapabilityNode,
  withExecutionInput,
  withExecutionLineage,
  type ExecutionRequest,
  type ExecutionResult,
  type ExecutionContract,
  type WorkflowPackage,
  type Logger,
  type ArtifactStore,
  type ArtifactRef,
  type ExecutionRepository,
  type ExecutionRecord,
  type LifecycleEvent,
  type ExecutionEventPublisher,
  type ExecutionPolicy,
  type PolicyEvaluator,
  type PolicyContext,
  type ApprovalManager,
  type PolicyViolation,
  type ChildExecutionContract,
  type ChildExecutionRequest,
  type WorkflowExecutionResolver,
  type CapabilityReuseResolver,
  type IncrementalExecutionPlanner,
  type ArtifactMaterializer,
  type ExecutionReconciler,
  type AgentInvocationService,
  type McpClient,
  DesignFlowError,
} from "@designflow/sdk";

import { CapabilityRegistry } from "../registry";
import { ExecutionEngine } from "../engine";
import { ExecutionServiceWorkflowResolver } from "../composition";
import { PolicyViolationError, ApprovalError } from "../errors";
import type { PendingChildApproval, PendingNodeApproval } from "../types";

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
  readonly approvalManager?: ApprovalManager;
  /**
   * Resolver used for child workflow nodes. Defaults to routing child
   * executions back through this service's own `executeChild`.
   */
  readonly workflowExecutionResolver?: WorkflowExecutionResolver;
  /**
   * Cache decision boundary consulted before each capability runs. Omitted by
   * default, so no work is ever skipped unless a host opts in.
   */
  readonly reuseResolver?: CapabilityReuseResolver;
  /**
   * Incremental planner consulted before each run. Omitted by default, so no
   * node is ever left out unless a host opts in.
   */
  readonly incrementalPlanner?: IncrementalExecutionPlanner;
  /**
   * Validates the artifacts a reuse decision offers before they are injected.
   * Omitted by default; the engine then applies its own existence check.
   */
  readonly artifactMaterializer?: ArtifactMaterializer;
  /**
   * Merges an incremental run's artifact sets. Applied only when an
   * incremental planner is also configured.
   */
  readonly executionReconciler?: ExecutionReconciler;
  /** Lets a capability invoke a registered specialized agent. Omitted by default. */
  readonly agentInvoker?: AgentInvocationService;
  /** Lets a capability reach a connected MCP server. Omitted by default. */
  readonly mcpClient?: McpClient;
}

interface StartExecutionParams {
  readonly workflowId: string;
  readonly input: unknown;
  readonly metadata: Record<string, unknown> | undefined;
}

// ── Execution Service ───────────────────────────────────────────

export class ExecutionService
  implements ExecutionContract, ChildExecutionContract
{
  private readonly workflowResolver: WorkflowResolver;
  private readonly capabilityRegistry: CapabilityRegistry;
  private readonly logger: Logger;
  private readonly artifactStore: ArtifactStore;
  private readonly executionRepository: ExecutionRepository;
  private readonly eventPublisher: ExecutionEventPublisher;
  private readonly policyEvaluator: PolicyEvaluator | undefined;
  private readonly policy: ExecutionPolicy | undefined;
  private readonly approvalManager: ApprovalManager | undefined;
  private readonly workflowExecutionResolver: WorkflowExecutionResolver;
  private readonly reuseResolver: CapabilityReuseResolver | undefined;
  private readonly incrementalPlanner: IncrementalExecutionPlanner | undefined;
  private readonly artifactMaterializer: ArtifactMaterializer | undefined;
  private readonly executionReconciler: ExecutionReconciler | undefined;
  private readonly agentInvoker: AgentInvocationService | undefined;
  private readonly mcpClient: McpClient | undefined;

  public constructor(config: ExecutionServiceConfig) {
    this.workflowResolver = config.workflowResolver;
    this.capabilityRegistry = config.capabilityRegistry;
    this.logger = config.logger;
    this.artifactStore = config.artifactStore;
    this.executionRepository = config.executionRepository;
    this.eventPublisher = config.eventPublisher;
    this.policyEvaluator = config.policyEvaluator;
    this.policy = config.policy !== undefined
      ? executionPolicySchema.parse(config.policy)
      : undefined;
    this.approvalManager = config.approvalManager;
    this.workflowExecutionResolver =
      config.workflowExecutionResolver ??
      new ExecutionServiceWorkflowResolver(this);
    this.reuseResolver = config.reuseResolver;
    this.incrementalPlanner = config.incrementalPlanner;
    this.artifactMaterializer = config.artifactMaterializer;
    this.executionReconciler = config.executionReconciler;
    this.agentInvoker = config.agentInvoker;
    this.mcpClient = config.mcpClient;
  }

  public async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const validatedRequest = this.validateRequest(request);

    if (validatedRequest.options?.resume) {
      return this.resume(validatedRequest.workflowId);
    }

    return this.startExecution({
      workflowId: validatedRequest.workflowId,
      input: validatedRequest.input,
      metadata: validatedRequest.metadata,
    });
  }

  /**
   * Internal entry point for child (composed) executions.
   *
   * Runs the full request validation → workflow resolution → policy →
   * persistence → events path, but against the child's own identity and
   * against a policy context built from the child workflow — the parent's
   * policy decision is never replayed.
   */
  public async executeChild(
    request: ChildExecutionRequest,
  ): Promise<ExecutionResult> {
    const validated = this.validateChildRequest(request);

    return this.startExecution({
      workflowId: validated.workflowId,
      input: validated.input,
      metadata: withExecutionLineage(validated.metadata, validated.lineage),
    });
  }

  private async startExecution(
    input: StartExecutionParams,
  ): Promise<ExecutionResult> {
    // The execution's input travels in metadata so that it is persisted with
    // the record and recoverable when the execution is resumed.
    const params: StartExecutionParams = {
      ...input,
      metadata: withExecutionInput(input.metadata, input.input),
    };

    const workflowPackage = this.resolveWorkflow(params.workflowId);

    const executionId = crypto.randomUUID();

    const now = Date.now();
    const record: ExecutionRecord = {
      executionId,
      workflowId: params.workflowId,
      status: "running",
      startedAt: now,
      metadata: params.metadata,
    };

    await this.executionRepository.create(record);
    await this.appendEvent(executionId, "created");

    try {
      if (this.policyEvaluator !== undefined && this.policy !== undefined) {
        const policyResult = await this.evaluatePolicy(
          workflowPackage,
          params,
        );

        if (!policyResult.allowed) {
          // Approval may only unblock an execution whose *every* violation is
          // an approval requirement. A hard denial alongside an approval rule
          // stays denied.
          const approvalOnly =
            policyResult.violations.length > 0 &&
            policyResult.violations.every(
              (violation) => violation.type === "approval_required",
            );

          if (approvalOnly && this.approvalManager !== undefined) {
            return this.handleApprovalRequired(
              executionId,
              params.workflowId,
              policyResult.violations,
              policyResult,
            );
          }

          await this.eventPublisher.publish({
            id: crypto.randomUUID(),
            executionId,
            type: "execution.policy_denied",
            timestamp: Date.now(),
            payload: {
              workflowId: params.workflowId,
              violations: policyResult.violations,
            },
          });

          await this.eventPublisher.publish({
            id: crypto.randomUUID(),
            executionId,
            type: "execution.failed",
            timestamp: Date.now(),
            payload: {
              workflowId: params.workflowId,
              reason: "policy_violation",
              violations: policyResult.violations,
            },
          });

          await this.markFailed(
            executionId,
            params.workflowId,
            new PolicyViolationError(
              "Execution denied by policy",
              {
                violations: policyResult.violations,
              },
            ),
          );

          const result: ExecutionResult = {
            executionId,
            workflowId: params.workflowId,
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

      const engine = this.createEngine();

      const abortController = new AbortController();

      const executionContext = {
        runId: executionId,
        workflowId: params.workflowId,
        stateRef: "initial",
        artifacts: [],
        metadata: params.metadata ?? {},
        signal: abortController.signal,
      };

      await this.appendEvent(executionId, "executing");

      const engineResult = await engine.run(
        workflowPackage.definition,
        executionContext,
      );

      return this.finalizeResult(executionId, params.workflowId, engineResult);
    } catch (error) {
      await this.markFailed(executionId, params.workflowId, error);
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

    if (latestRecord.status === "waiting_approval" && this.approvalManager !== undefined) {
      const approvalId = typeof latestRecord.metadata?.approvalId === "string" ? latestRecord.metadata.approvalId : undefined;
      if (approvalId !== undefined) {
        const approval = await this.approvalManager.get(approvalId);
        if (approval?.status === "pending") return executionResultSchema.parse({ executionId: latestRecord.executionId, workflowId, status: "pending_approval", artifacts: [], error: { code: "ERR_APPROVAL_PENDING", message: approval.reason } });
      }
    }

    return this.resumeExecution(latestRecord, workflowPackage);
  }

  public async resumeAfterApproval(approvalId: string): Promise<ExecutionResult> {
    if (this.approvalManager === undefined) {
      throw new ApprovalError("Approval manager not configured");
    }

    const approval = await this.approvalManager.get(approvalId);

    if (approval === null) {
      return executionResultSchema.parse({
        executionId: "",
        workflowId: "",
        status: "failed",
        artifacts: [],
        error: {
          code: "ERR_APPROVAL_NOT_FOUND",
          message: `Approval not found: ${approvalId}`,
        },
      });
    }

    if (approval.status === "pending") {
      return executionResultSchema.parse({
        executionId: approval.executionId,
        workflowId: approval.workflowId,
        status: "pending_approval",
        artifacts: [],
        error: {
          code: "ERR_APPROVAL_PENDING",
          message: `Approval ${approvalId} is still pending`,
        },
      });
    }

    if (approval.status === "rejected") {
      await this.eventPublisher.publish({
        id: crypto.randomUUID(),
        executionId: approval.executionId,
        type: "execution.approval_rejected",
        timestamp: Date.now(),
        payload: {
          approvalId: approval.id,
          workflowId: approval.workflowId,
          reason: approval.reason,
          comment: approval.metadata?.comment,
          resolvedAt: approval.resolvedAt,
        },
      });

      // A rejected approval terminates the execution. Without this the record
      // would stay `waiting_approval` and a composing parent would keep
      // treating the child as still pending.
      await this.markFailed(
        approval.executionId,
        approval.workflowId,
        new ApprovalError(`Approval rejected: ${approval.reason}`, {
          approvalId: approval.id,
        }),
      );

      const result: ExecutionResult = {
        executionId: approval.executionId,
        workflowId: approval.workflowId,
        status: "failed",
        artifacts: [],
        error: {
          code: "ERR_APPROVAL_REJECTED",
          message: `Approval rejected: ${approval.reason}`,
        },
      };
      return executionResultSchema.parse(result);
    }

    await this.eventPublisher.publish({
      id: crypto.randomUUID(),
      executionId: approval.executionId,
      type: "execution.approval_approved",
      timestamp: Date.now(),
      payload: {
        approvalId: approval.id,
        workflowId: approval.workflowId,
        comment: approval.metadata?.comment,
        resolvedAt: approval.resolvedAt,
      },
    });

    const record = await this.executionRepository.get(approval.executionId);

    if (record === null) {
      throw new DesignFlowError(
        "ERR_EXECUTION_NOT_FOUND",
        `Execution record not found: ${approval.executionId}`,
        { executionId: approval.executionId },
      );
    }

    await this.validateNodeApprovalBinding(record, approval);
    const nodeBinding = record.metadata?.nodeApprovalBinding;
    const approvedNodeId = typeof nodeBinding === "object" && nodeBinding !== null && typeof (nodeBinding as { nodeId?: unknown }).nodeId === "string" ? (nodeBinding as { nodeId: string }).nodeId : undefined;
    if (approvedNodeId !== undefined) {
      await this.executionRepository.update(record.executionId, { metadata: await this.mergeRecordMetadata(record.executionId, { approvedNodeId, consumedApprovalId: approval.id }) });
    }

    const workflowPackage = this.resolveWorkflow(approval.workflowId);

    const resumedRecord = approvedNodeId !== undefined
      ? await this.executionRepository.get(record.executionId)
      : record;
    return this.resumeExecution(resumedRecord ?? record, workflowPackage);
  }

  public async resumeAfterConsumedApproval(
    executionId: string,
  ): Promise<ExecutionResult> {
    const record = await this.executionRepository.get(executionId);
    if (record === null)
      throw new DesignFlowError(
        "ERR_EXECUTION_NOT_FOUND",
        `Execution record not found: ${executionId}`,
        { executionId },
      );
    const nodeBinding = record.metadata?.nodeApprovalBinding;
    const approvedNodeId =
      typeof nodeBinding === "object" &&
      nodeBinding !== null &&
      typeof (nodeBinding as { nodeId?: unknown }).nodeId === "string"
        ? (nodeBinding as { nodeId: string }).nodeId
        : undefined;
    const recoveredApprovedNodeId =
      approvedNodeId ??
      (record.workflowId === "design-to-code-feedback-loop"
        ? "create-correction-snapshot"
        : undefined);
    if (recoveredApprovedNodeId === undefined)
      throw new DesignFlowError(
        "ERR_APPROVAL_NOT_FOUND",
        `No consumed node approval binding found for execution: ${executionId}`,
        { executionId },
      );
    const updated = await this.executionRepository.update(executionId, {
      metadata: await this.mergeRecordMetadata(executionId, {
        approvedNodeId: recoveredApprovedNodeId,
      }),
    });
    const workflowPackage = this.resolveWorkflow(record.workflowId);
    return this.resumeExecution(updated ?? record, workflowPackage);
  }

  private async resumeExecution(
    record: ExecutionRecord,
    workflowPackage: WorkflowPackage,
  ): Promise<ExecutionResult> {
    switch (record.status) {
      case "completed": {
        const checkpoint = await this.executionRepository.getLatestCheckpoint(
          record.executionId,
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
          executionId: record.executionId,
          workflowId: record.workflowId,
          status: "completed",
          artifacts,
        };
        return executionResultSchema.parse(result);
      }

      case "failed":
      case "cancelled": {
        const result: ExecutionResult = {
          executionId: record.executionId,
          workflowId: record.workflowId,
          status: record.status,
          artifacts: [],
          error: {
            code: "WORKFLOW_PREVIOUSLY_TERMINATED",
            message: `Workflow previously ${record.status}, cannot resume`,
          },
        };
        return executionResultSchema.parse(result);
      }

      case "running":
      case "waiting_approval": {
        const engine = this.createEngine();

        await this.appendEvent(record.executionId, "executing");

        try {
          const engineResult = await engine.resume(
            workflowPackage.definition,
            record.workflowId,
            record.executionId,
          );

          return this.finalizeResult(
            record.executionId,
            record.workflowId,
            engineResult,
          );
        } catch (error) {
          await this.markFailed(record.executionId, record.workflowId, error);
          throw error;
        }
      }
    }
  }

  private async handleApprovalRequired(
    executionId: string,
    workflowId: string,
    approvalViolations: readonly PolicyViolation[],
    policyResult: { violations: readonly PolicyViolation[] },
  ): Promise<ExecutionResult> {
    const reason = approvalViolations.map((v) => v.message).join("; ");

    const approvalRequest = await this.approvalManager!.createRequest(
      executionId,
      workflowId,
      reason,
    );

    // Merge, never replace: the record's metadata carries this execution's
    // lineage and input, both of which are needed to resume it.
    await this.executionRepository.update(executionId, {
      status: "waiting_approval",
      metadata: await this.mergeRecordMetadata(executionId, {
        approvalId: approvalRequest.id,
      }),
    });

    await this.appendEvent(executionId, "waiting_approval");

    await this.eventPublisher.publish({
      id: crypto.randomUUID(),
      executionId,
      type: "execution.waiting_approval",
      timestamp: Date.now(),
      payload: {
        workflowId,
        approvalId: approvalRequest.id,
        reason,
        violations: policyResult.violations,
      },
    });

    const result: ExecutionResult = {
      executionId,
      workflowId,
      status: "pending_approval",
      artifacts: [],
      error: {
        code: "ERR_APPROVAL_REQUIRED",
        message: `Approval required: ${reason}`,
      },
    };

    return executionResultSchema.parse(result);
  }

  private async evaluatePolicy(
    workflowPackage: WorkflowPackage,
    params: StartExecutionParams,
  ): Promise<ReturnType<PolicyEvaluator["evaluate"]>> {
    // Only this workflow's own capability nodes are considered. Child workflow
    // nodes are evaluated independently when their execution starts.
    const capabilityIds = workflowPackage.definition.nodes
      .filter(isCapabilityNode)
      .map((node) => node.capabilityId);

    const environment =
      typeof params.metadata?.environment === "string"
        ? params.metadata.environment
        : undefined;

    const context: PolicyContext = {
      workflowId: params.workflowId,
      capabilityIds,
      environment,
      metadata: params.metadata,
    };

    return this.policyEvaluator!.evaluate(this.policy!, context);
  }

  /** Builds an engine from this service's collaborators. */
  private createEngine(): ExecutionEngine {
    return new ExecutionEngine({
      registry: this.capabilityRegistry,
      logger: this.logger,
      artifactStore: this.artifactStore,
      executionRepository: this.executionRepository,
      eventPublisher: this.eventPublisher,
      workflowExecutionResolver: this.workflowExecutionResolver,
      reuseResolver: this.reuseResolver,
      incrementalPlanner: this.incrementalPlanner,
      artifactMaterializer: this.artifactMaterializer,
      executionReconciler: this.executionReconciler,
      agentInvoker: this.agentInvoker,
      mcpClient: this.mcpClient,
      policyEvaluator: this.policyEvaluator,
      policy: this.policy,
    });
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
    engineResult: {
      success: boolean;
      artifacts: readonly ArtifactRef[];
      error: unknown;
      pendingApproval: PendingChildApproval | PendingNodeApproval | undefined;
    },
  ): Promise<ExecutionResult> {
    const artifacts = engineResult.artifacts.map((a) => ({
      id: a.id,
      type: a.type,
      metadata: a.metadata ?? {},
    }));

    // A node-level approval is created only after all preceding planning nodes
    // have produced their artifacts. This keeps the approval record bound to
    // the exact proposal state that the user can inspect.
    if (!engineResult.success && engineResult.pendingApproval?.kind === "node") {
      const pending = engineResult.pendingApproval as PendingNodeApproval;
      const binding = await this.createNodeApprovalBinding(executionId, workflowId, pending, artifacts);
      const approvalRequest = await this.approvalManager!.createRequest(executionId, workflowId, pending.message);
      const finalBinding = { ...binding, approvalId: approvalRequest.id, expiresAt: approvalRequest.expiresAt };
      await this.executionRepository.update(executionId, {
        status: "waiting_approval",
        metadata: await this.mergeRecordMetadata(executionId, {
          approvalId: approvalRequest.id,
          nodeApprovalBinding: finalBinding,
        }),
      });
      await this.appendEvent(executionId, "waiting_approval");
      const pendingResult: ExecutionResult = { executionId, workflowId, status: "pending_approval", artifacts, error: { code: "ERR_APPROVAL_REQUIRED", message: pending.message } };
      return executionResultSchema.parse(pendingResult);
    }

    // A blocked-on-approval execution stays resumable — it is not a failure.
    if (!engineResult.success && engineResult.pendingApproval !== undefined) {
      const pending = engineResult.pendingApproval as PendingChildApproval;

      await this.executionRepository.update(executionId, {
        status: "waiting_approval",
        metadata: await this.mergeRecordMetadata(executionId, {
          pendingChildExecutionId: pending.childExecutionId,
          pendingChildWorkflowId: pending.childWorkflowId,
          pendingNodeId: pending.nodeId,
        }),
      });

      await this.appendEvent(executionId, "waiting_approval");

      const pendingResult: ExecutionResult = {
        executionId,
        workflowId,
        status: "pending_approval",
        artifacts,
        error: {
          code: "ERR_CHILD_APPROVAL_REQUIRED",
          message: pending.message,
        },
      };

      return executionResultSchema.parse(pendingResult);
    }

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
          code: engineResult.error instanceof DesignFlowError
            ? engineResult.error.code
            : engineResult.error instanceof Error
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
      artifacts,
      error,
    };

    return executionResultSchema.parse(result);
  }

  private async mergeRecordMetadata(
    executionId: string,
    patch: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const record = await this.executionRepository.get(executionId);
    return { ...record?.metadata, ...patch };
  }

  private async createNodeApprovalBinding(
    executionId: string,
    workflowId: string,
    pending: PendingNodeApproval,
    artifacts: readonly { id: string; type: string; metadata: Record<string, unknown>; version?: number }[],
  ): Promise<Record<string, unknown>> {
    const proposalArtifactId = typeof pending.metadata.proposalArtifactId === "string" ? pending.metadata.proposalArtifactId : undefined;
    const contextArtifactId = typeof pending.metadata.projectContextArtifactId === "string" ? pending.metadata.projectContextArtifactId : undefined;
    // Generic node-level approvals remain supported for existing workflows. Stage 4
    // supplies the artifact metadata below and therefore receives strict proposal
    // binding; older node policies retain the same approval semantics as before.
    if (proposalArtifactId === undefined || contextArtifactId === undefined) {
      return { workflowId, executionId, nodeId: pending.nodeId, genericNodeApproval: true };
    }
    const proposalRef = artifacts.find((artifact) => artifact.id === proposalArtifactId);
    const contextRef = artifacts.find((artifact) => artifact.id === contextArtifactId);
    const proposalPayloadId = typeof proposalRef?.metadata.payloadId === "string" ? proposalRef.metadata.payloadId : undefined;
    const contextPayloadId = typeof contextRef?.metadata.payloadId === "string" ? contextRef.metadata.payloadId : undefined;
    const proposal = proposalPayloadId === undefined ? null : await this.artifactStore.get(proposalPayloadId);
    const projectContext = contextPayloadId === undefined ? null : await this.artifactStore.get(contextPayloadId);
    if (proposal === null || projectContext === null || proposalRef === undefined) throw new ApprovalError("The proposal or project context artifact is missing.");
    const proposalData = proposal.data as { projectId?: unknown; baseProjectFingerprint?: unknown; files?: unknown[]; packageChanges?: unknown[]; commandsRequested?: unknown[] };
    const contextData = projectContext.data as { project?: { id?: unknown; rootIdentity?: unknown } };
    const projectId = typeof proposalData.projectId === "string" ? proposalData.projectId : undefined;
    const baseProjectFingerprint = typeof proposalData.baseProjectFingerprint === "string" ? proposalData.baseProjectFingerprint : undefined;
    const rootIdentity = typeof contextData.project?.rootIdentity === "string" ? contextData.project.rootIdentity : undefined;
    const contextProjectId = typeof contextData.project?.id === "string" ? contextData.project.id : undefined;
    if (projectId === undefined || baseProjectFingerprint === undefined || rootIdentity === undefined || contextProjectId !== projectId) throw new ApprovalError("The proposal is missing a valid registered project identity.");
    const proposalHash = await hashApprovalPayload(proposalData);
    return { workflowId, executionId, nodeId: pending.nodeId, proposalArtifactId, proposalVersion: proposalRef.version ?? 1, proposalHash, projectId, rootIdentity, baseProjectFingerprint, createCount: proposalData.files?.filter((file) => typeof file === "object" && file !== null && (file as { action?: unknown }).action === "create").length ?? 0, modifyCount: proposalData.files?.filter((file) => typeof file === "object" && file !== null && (file as { action?: unknown }).action === "modify").length ?? 0, dependencyChangeCount: proposalData.packageChanges?.length ?? 0, validationCommands: proposalData.commandsRequested ?? [] };
  }

  private async validateNodeApprovalBinding(record: ExecutionRecord, approval: { id: string; executionId: string; workflowId: string; status: string }): Promise<void> {
    const raw = record.metadata?.nodeApprovalBinding;
    if (raw === undefined) return;
    if (approval.status !== "approved" || approval.executionId !== record.executionId || approval.workflowId !== record.workflowId) throw new ApprovalError("Approval does not match this execution.");
    if (typeof raw !== "object" || raw === null) throw new ApprovalError("Approval binding is invalid.");
    const binding = raw as { approvalId?: unknown; proposalArtifactId?: unknown; proposalVersion?: unknown; proposalHash?: unknown; projectId?: unknown; rootIdentity?: unknown; baseProjectFingerprint?: unknown; nodeId?: unknown };
    if (binding.approvalId !== approval.id || typeof binding.nodeId !== "string") throw new ApprovalError("Approval binding is incomplete.");
    if ((raw as { genericNodeApproval?: unknown }).genericNodeApproval === true) return;
    if (typeof binding.proposalArtifactId !== "string" || typeof binding.proposalHash !== "string" || typeof binding.proposalVersion !== "number" || typeof binding.projectId !== "string" || typeof binding.rootIdentity !== "string" || typeof binding.baseProjectFingerprint !== "string") throw new ApprovalError("Approval binding is incomplete.");
    const recordArtifacts = await this.executionRepository.getLatestCheckpoint(record.executionId);
    const checkpointMetadata = recordArtifacts?.metadata;
    const refs = Array.isArray(checkpointMetadata?.appliedArtifacts)
      ? checkpointMetadata.appliedArtifacts as { id: string; metadata?: Record<string, unknown>; version?: number }[]
      : typeof checkpointMetadata?.nodeApprovalCheckpoint === "object" && checkpointMetadata.nodeApprovalCheckpoint !== null && Array.isArray((checkpointMetadata.nodeApprovalCheckpoint as { completedArtifacts?: unknown }).completedArtifacts)
        ? (checkpointMetadata.nodeApprovalCheckpoint as { completedArtifacts: { id: string; metadata?: Record<string, unknown>; version?: number }[] }).completedArtifacts
        : [];
    const proposalRef = refs.find((ref) => ref.id === binding.proposalArtifactId);
    const payloadId = typeof proposalRef?.metadata?.payloadId === "string" ? proposalRef.metadata.payloadId : undefined;
    const proposal = payloadId === undefined ? null : await this.artifactStore.get(payloadId);
    if (proposal === null || (proposalRef?.version ?? 1) !== binding.proposalVersion || await hashApprovalPayload(proposal.data) !== binding.proposalHash) throw new ApprovalError("The approved proposal changed or is unavailable.");
    const proposalData = proposal.data as { projectId?: unknown; baseProjectFingerprint?: unknown };
    if (proposalData.projectId !== binding.projectId || proposalData.baseProjectFingerprint !== binding.baseProjectFingerprint) throw new ApprovalError("The approved project state no longer matches the proposal.");
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

  private validateChildRequest(
    request: ChildExecutionRequest,
  ): ChildExecutionRequest {
    const result = childExecutionRequestSchema.safeParse(request);

    if (!result.success) {
      throw new InvalidRequestError(
        `Invalid child execution request: ${result.error.message}`,
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

async function hashApprovalPayload(value: unknown): Promise<string> {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
