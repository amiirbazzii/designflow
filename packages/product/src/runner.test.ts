import { describe, expect, test } from "bun:test";
import type {
  ApprovalManager,
  ApprovalRequest,
  ExecutionContract,
  ExecutionEvent,
  ExecutionRecord,
  ExecutionRepository,
  ExecutionRequest,
  ExecutionResult,
} from "@designflow/sdk";
import { DesignFlowError } from "@designflow/sdk";
import { WorkflowRunner } from "./runner";
import { InMemoryExecutionEventCollector } from "./event-collector";
import { buildProgress, humanizeCapabilityId } from "./progress";

// ── Test Doubles ────────────────────────────────────────────────

class StubRepository implements ExecutionRepository {
  public readonly records = new Map<string, ExecutionRecord>();

  public add(record: ExecutionRecord): void {
    this.records.set(record.executionId, record);
  }

  public async create(record: ExecutionRecord): Promise<void> {
    this.records.set(record.executionId, record);
  }
  public async update(
    executionId: string,
    patch: Partial<Omit<ExecutionRecord, "executionId">>,
  ): Promise<void> {
    const existing = this.records.get(executionId);
    if (existing !== undefined) {
      this.records.set(executionId, { ...existing, ...patch });
    }
  }
  public async get(executionId: string): Promise<ExecutionRecord | null> {
    return this.records.get(executionId) ?? null;
  }
  public async list(workflowId: string): Promise<readonly ExecutionRecord[]> {
    return [...this.records.values()].filter((r) => r.workflowId === workflowId);
  }
  public async appendEvent(): Promise<void> {}
  public async listEvents(): Promise<readonly never[]> {
    return [];
  }
  public async saveCheckpoint(): Promise<void> {}
  public async getLatestCheckpoint(): Promise<null> {
    return null;
  }
}

/**
 * Stands in for `ExecutionService`. Records what it was asked to do so the
 * tests can prove the product layer delegates rather than re-implements.
 */
class StubExecutionContract implements ExecutionContract {
  public readonly executed: ExecutionRequest[] = [];
  public readonly resumedApprovals: string[] = [];

  private readonly result: ExecutionResult;
  private readonly afterApproval: ExecutionResult;

  public constructor(
    result: ExecutionResult,
    afterApproval: ExecutionResult = result,
  ) {
    this.result = result;
    this.afterApproval = afterApproval;
  }

  public async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    this.executed.push(request);
    return this.result;
  }

  public async resume(): Promise<ExecutionResult> {
    return this.result;
  }

  public async resumeAfterApproval(
    approvalId: string,
  ): Promise<ExecutionResult> {
    this.resumedApprovals.push(approvalId);
    return this.afterApproval;
  }
}

class StubApprovalManager implements ApprovalManager {
  public readonly approved: Array<{ id: string; comment?: string }> = [];
  public readonly rejected: Array<{ id: string; comment?: string }> = [];

  private readonly requests = new Map<string, ApprovalRequest>();

  public add(request: ApprovalRequest): void {
    this.requests.set(request.id, request);
  }

  public async createRequest(
    executionId: string,
    workflowId: string,
    reason: string,
  ): Promise<ApprovalRequest> {
    const request: ApprovalRequest = {
      id: `approval-${executionId}`,
      executionId,
      workflowId,
      status: "pending",
      reason,
      createdAt: 0,
    };
    this.requests.set(request.id, request);
    return request;
  }

  public async approve(
    approvalId: string,
    comment?: string,
  ): Promise<ApprovalRequest> {
    this.approved.push({ id: approvalId, ...(comment !== undefined ? { comment } : {}) });
    return this.settle(approvalId, "approved");
  }

  public async reject(
    approvalId: string,
    comment?: string,
  ): Promise<ApprovalRequest> {
    this.rejected.push({ id: approvalId, ...(comment !== undefined ? { comment } : {}) });
    return this.settle(approvalId, "rejected");
  }

  public async get(approvalId: string): Promise<ApprovalRequest | null> {
    return this.requests.get(approvalId) ?? null;
  }

  private settle(
    approvalId: string,
    status: "approved" | "rejected",
  ): ApprovalRequest {
    const existing = this.requests.get(approvalId);
    if (existing === undefined) throw new Error(`unknown approval ${approvalId}`);

    const settled: ApprovalRequest = { ...existing, status, resolvedAt: 1 };
    this.requests.set(approvalId, settled);
    return settled;
  }
}

// ── Fixtures ────────────────────────────────────────────────────

const BASE = 1_700_000_000_000;

let seq = 0;
const event = (
  type: ExecutionEvent["type"],
  offsetMs: number,
  payload?: Record<string, unknown>,
): ExecutionEvent => ({
  id: `evt-${seq++}`,
  executionId: "exec-1",
  type,
  timestamp: BASE + offsetMs,
  ...(payload !== undefined ? { payload } : {}),
});

const record = (overrides?: Partial<ExecutionRecord>): ExecutionRecord => ({
  executionId: "exec-1",
  workflowId: "design-to-code",
  status: "completed",
  startedAt: BASE,
  completedAt: BASE + 42_000,
  ...overrides,
});

const feed = (
  collector: InMemoryExecutionEventCollector,
  events: readonly ExecutionEvent[],
): void => {
  const handler = collector.createHandler();
  for (const item of events) void handler(item);
};

interface Harness {
  readonly runner: WorkflowRunner;
  readonly repository: StubRepository;
  readonly collector: InMemoryExecutionEventCollector;
  readonly contract: StubExecutionContract;
  readonly approvals: StubApprovalManager;
}

const createHarness = (options?: {
  readonly result?: ExecutionResult;
  readonly afterApproval?: ExecutionResult;
  readonly stepCount?: number;
  readonly withApprovals?: boolean;
}): Harness => {
  const repository = new StubRepository();
  const collector = new InMemoryExecutionEventCollector();
  const approvals = new StubApprovalManager();

  const contract = new StubExecutionContract(
    options?.result ?? {
      executionId: "exec-1",
      workflowId: "design-to-code",
      status: "completed",
      artifacts: [],
    },
    options?.afterApproval,
  );

  const runner = new WorkflowRunner({
    executionContract: contract,
    executionRepository: repository,
    eventSource: collector,
    resolveWorkflowName: (id) =>
      id === "design-to-code" ? "Design → Code" : undefined,
    ...(options?.withApprovals !== false ? { approvalManager: approvals } : {}),
    ...(options?.stepCount !== undefined
      ? { resolveWorkflowStepCount: () => options.stepCount }
      : {}),
  });

  return { runner, repository, collector, contract, approvals };
};

// ── 1. Workflow launch ──────────────────────────────────────────

describe("workflow launch", () => {
  test("starts a workflow without the caller touching engine plumbing", async () => {
    const harness = createHarness();

    const execution = await harness.runner.start({
      workflowId: "design-to-code",
      input: { designFile: "homepage.fig" },
    });

    expect(execution.executionId).toBe("exec-1");
    expect(execution.workflowId).toBe("design-to-code");
    expect(execution.workflowName).toBe("Design → Code");
    expect(execution.state).toBe("ready");
  });

  test("delegates to the execution contract verbatim", async () => {
    const harness = createHarness();

    await harness.runner.start({
      workflowId: "design-to-code",
      input: { designFile: "homepage.fig" },
      metadata: { environment: "staging" },
    });

    // The product layer builds no ExecutionContext and starts nothing itself.
    expect(harness.contract.executed).toEqual([
      {
        workflowId: "design-to-code",
        input: { designFile: "homepage.fig" },
        metadata: { environment: "staging" },
      },
    ]);
  });

  test("omits input and metadata when the caller supplies none", async () => {
    const harness = createHarness();

    await harness.runner.start({ workflowId: "design-to-code" });

    expect(harness.contract.executed[0]).toEqual({
      workflowId: "design-to-code",
    });
  });

  test("reports a blocked launch as needing approval", async () => {
    const harness = createHarness({
      result: {
        executionId: "exec-1",
        workflowId: "design-to-code",
        status: "pending_approval",
        artifacts: [],
      },
    });

    const execution = await harness.runner.start({
      workflowId: "design-to-code",
    });

    expect(execution.state).toBe("needs_approval");
  });

  test("reports a failed run through state rather than throwing", async () => {
    const harness = createHarness({
      result: {
        executionId: "exec-1",
        workflowId: "design-to-code",
        status: "failed",
        artifacts: [],
        error: { code: "ERR_EXECUTION_FAILED", message: "boom" },
      },
    });

    // A workflow that ran and failed is an outcome to display, not an error in
    // the act of launching.
    const execution = await harness.runner.start({
      workflowId: "design-to-code",
    });

    expect(execution.state).toBe("failed");
  });

  test("rejects a launch with no workflow id", async () => {
    const harness = createHarness();

    await expect(harness.runner.start({ workflowId: "" })).rejects.toThrow();
  });
});

// ── 2. Status ───────────────────────────────────────────────────

describe("execution status", () => {
  test("answers what is happening right now", async () => {
    const harness = createHarness({ stepCount: 8 });
    harness.repository.add(record({ status: "running", completedAt: undefined }));
    feed(harness.collector, [
      event("execution.started", 0),
      event("capability.started", 100, { capabilityId: "cap-extract-tokens" }),
      event("capability.completed", 200, { capabilityId: "cap-extract-tokens" }),
      event("capability.started", 300, { capabilityId: "cap-build-structure" }),
      event("capability.completed", 400, { capabilityId: "cap-build-structure" }),
      event("capability.started", 500, { capabilityId: "cap-generate-components" }),
    ]);

    const status = await harness.runner.status("exec-1");

    expect(status.state).toBe("running");
    expect(status.currentStep).toBe("Generate components");
    expect(status.progress.completed).toBe(2);
    expect(status.progress.total).toBe(8);
    expect(status.message).toBe("Generate components (2 of 8)");
  });

  test("reports a finished run with its summary", async () => {
    const harness = createHarness();
    harness.repository.add(record());
    feed(harness.collector, [
      event("execution.started", 0),
      event("capability.started", 100, { capabilityId: "cap-generate" }),
      event("capability.completed", 200, { capabilityId: "cap-generate" }),
      event("execution.completed", 300),
    ]);

    const status = await harness.runner.status("exec-1");

    expect(status.state).toBe("ready");
    expect(status.progress.percent).toBe(100);
    expect(status.currentStep).toBeUndefined();
    expect(status.message).toContain("Design → Code finished");
  });

  test("surfaces the approval reason in the status message", async () => {
    const harness = createHarness();
    harness.repository.add(
      record({
        status: "waiting_approval",
        completedAt: undefined,
        metadata: { approvalId: "approval-1" },
      }),
    );
    harness.approvals.add({
      id: "approval-1",
      executionId: "exec-1",
      workflowId: "design-to-code",
      status: "pending",
      reason: "Writing changes to production files",
      createdAt: BASE,
    });

    const status = await harness.runner.status("exec-1");

    expect(status.state).toBe("needs_approval");
    expect(status.approval?.reason).toBe(
      "Writing changes to production files",
    );
    expect(status.message).toBe(
      "Needs your approval — Writing changes to production files",
    );
  });

  test("rejects an unknown execution", async () => {
    const harness = createHarness();

    try {
      await harness.runner.status("missing");
      throw new Error("expected a rejection");
    } catch (error) {
      if (!(error instanceof DesignFlowError)) throw error;
      expect(error.code).toBe("ERR_EXECUTION_NOT_FOUND");
    }
  });
});

// ── 3. Progress ─────────────────────────────────────────────────

describe("progress model", () => {
  test("turns capability events into a readable checklist", () => {
    const progress = buildProgress([
      event("capability.started", 0, { capabilityId: "cap-extract-design-tokens" }),
      event("capability.completed", 1, { capabilityId: "cap-extract-design-tokens" }),
      event("capability.started", 2, { capabilityId: "cap-generate-structure" }),
      event("capability.completed", 3, { capabilityId: "cap-generate-structure" }),
      event("capability.started", 4, { capabilityId: "cap-create-react-components" }),
    ]);

    expect(progress.steps).toEqual([
      { label: "Extract design tokens", status: "done", capabilityId: "cap-extract-design-tokens" },
      { label: "Generate structure", status: "done", capabilityId: "cap-generate-structure" },
      { label: "Create react components", status: "active", capabilityId: "cap-create-react-components" },
    ]);
    expect(progress.currentStep).toBe("Create react components");
    expect(progress.completed).toBe(2);
  });

  test("counts a reused step as done", () => {
    const progress = buildProgress([
      event("artifact.reused", 0, {
        artifactId: "tokens",
        capabilityId: "cap-extract-tokens",
      }),
      event("capability.started", 1, { capabilityId: "cap-generate" }),
      event("capability.completed", 2, { capabilityId: "cap-generate" }),
    ]);

    // A reused node emits no capability events but is done to a reader.
    expect(progress.completed).toBe(2);
    expect(progress.steps[0]).toEqual({
      label: "Extract tokens",
      status: "done",
      capabilityId: "cap-extract-tokens",
    });
  });

  test("takes its denominator from the planner when one ran", () => {
    const progress = buildProgress([
      event("execution.plan_created", 0, {
        executionNodes: ["a", "b", "c"],
        skippedNodes: ["d"],
      }),
      event("capability.started", 1, { capabilityId: "cap-a" }),
      event("capability.completed", 2, { capabilityId: "cap-a" }),
    ]);

    expect(progress.total).toBe(4);
    expect(progress.completed).toBe(1);
    expect(progress.percent).toBe(25);
  });

  test("pads unseen steps so a checklist can render up front", () => {
    const progress = buildProgress([], 3);

    expect(progress.steps).toHaveLength(3);
    expect(progress.steps.every((step) => step.status === "pending")).toBe(true);
    expect(progress.percent).toBe(0);
  });

  test("grows the denominator as steps appear when nothing declared one", () => {
    const progress = buildProgress([
      event("capability.started", 0, { capabilityId: "cap-a" }),
      event("capability.completed", 1, { capabilityId: "cap-a" }),
    ]);

    // Never claims a denominator it does not have.
    expect(progress.total).toBe(1);
    expect(progress.percent).toBe(100);
  });

  test("stops reporting an active step once the run has ended", () => {
    const progress = buildProgress([
      event("capability.started", 0, { capabilityId: "cap-a" }),
      event("execution.failed", 1, { reason: "boom" }),
    ]);

    expect(progress.currentStep).toBeUndefined();
    expect(progress.steps[0]?.status).toBe("pending");
  });

  test("reports zero percent for a run with no steps", () => {
    const progress = buildProgress([]);

    expect(progress).toEqual({
      completed: 0,
      total: 0,
      percent: 0,
      steps: [],
    });
  });

  test("humanizes capability ids", () => {
    expect(humanizeCapabilityId("cap-extract-design-tokens")).toBe(
      "Extract design tokens",
    );
    expect(humanizeCapabilityId("generate_react_components")).toBe(
      "Generate react components",
    );
    expect(humanizeCapabilityId("build")).toBe("Build");
  });

  test("repeats a capability used by two nodes as two steps", () => {
    const progress = buildProgress([
      event("capability.started", 0, { capabilityId: "cap-render" }),
      event("capability.completed", 1, { capabilityId: "cap-render" }),
      event("capability.started", 2, { capabilityId: "cap-render" }),
      event("capability.completed", 3, { capabilityId: "cap-render" }),
    ]);

    expect(progress.steps).toHaveLength(2);
    expect(progress.completed).toBe(2);
  });
});

// ── 4. Approval ─────────────────────────────────────────────────

describe("approval", () => {
  const blockedHarness = (afterApproval?: ExecutionResult): Harness => {
    const harness = createHarness({
      ...(afterApproval !== undefined ? { afterApproval } : {}),
    });

    harness.repository.add(
      record({
        status: "waiting_approval",
        completedAt: undefined,
        metadata: { approvalId: "approval-1" },
      }),
    );
    harness.approvals.add({
      id: "approval-1",
      executionId: "exec-1",
      workflowId: "design-to-code",
      status: "pending",
      reason: "Writing changes to production files",
      createdAt: BASE,
    });

    return harness;
  };

  test("exposes the pending approval a person must answer", async () => {
    const harness = blockedHarness();

    const pending = await harness.runner.pendingApproval("exec-1");

    expect(pending).toEqual({
      approvalId: "approval-1",
      executionId: "exec-1",
      workflowId: "design-to-code",
      reason: "Writing changes to production files",
      requestedAt: BASE,
    });
  });

  test("delegates approval to the approval manager and the engine", async () => {
    const harness = blockedHarness();

    const outcome = await harness.runner.approve("exec-1", "looks right");

    // The product layer decides nothing; it records the decision through the
    // engine's own interfaces and then asks the engine to act on it.
    expect(harness.approvals.approved).toEqual([
      { id: "approval-1", comment: "looks right" },
    ]);
    expect(harness.contract.resumedApprovals).toEqual(["approval-1"]);
    expect(outcome.decision).toBe("approve");
    expect(outcome.state).toBe("ready");
  });

  test("delegates rejection the same way", async () => {
    const harness = blockedHarness({
      executionId: "exec-1",
      workflowId: "design-to-code",
      status: "failed",
      artifacts: [],
      error: { code: "ERR_APPROVAL_REJECTED", message: "rejected" },
    });

    const outcome = await harness.runner.reject("exec-1", "not yet");

    expect(harness.approvals.rejected).toEqual([
      { id: "approval-1", comment: "not yet" },
    ]);
    expect(harness.approvals.approved).toEqual([]);
    expect(outcome.decision).toBe("reject");
    expect(outcome.message).toBe("Rejected. The workflow was stopped.");
  });

  test("finds the approval from the event stream when metadata lacks it", async () => {
    const harness = createHarness();
    harness.repository.add(
      record({ status: "waiting_approval", completedAt: undefined }),
    );
    harness.approvals.add({
      id: "approval-9",
      executionId: "exec-1",
      workflowId: "design-to-code",
      status: "pending",
      reason: "needs a look",
      createdAt: BASE,
    });
    feed(harness.collector, [
      event("execution.waiting_approval", 100, {
        approvalId: "approval-9",
        reason: "needs a look",
      }),
    ]);

    const pending = await harness.runner.pendingApproval("exec-1");

    expect(pending?.approvalId).toBe("approval-9");
  });

  test("reports no pending approval for a finished run", async () => {
    const harness = createHarness();
    harness.repository.add(record());

    expect(await harness.runner.pendingApproval("exec-1")).toBeNull();
  });

  test("refuses to decide an approval that is not pending", async () => {
    const harness = createHarness();
    harness.repository.add(record());

    try {
      await harness.runner.approve("exec-1");
      throw new Error("expected a rejection");
    } catch (error) {
      if (!(error instanceof DesignFlowError)) throw error;
      expect(error.code).toBe("ERR_NO_PENDING_APPROVAL");
    }

    expect(harness.contract.resumedApprovals).toEqual([]);
  });

  test("reports no approval when no manager is configured", async () => {
    const harness = createHarness({ withApprovals: false });
    harness.repository.add(record());

    expect(await harness.runner.pendingApproval("exec-1")).toBeNull();
  });
});

// ── 5. History ──────────────────────────────────────────────────

describe("workflow history", () => {
  test("lists previous executions newest first", async () => {
    const harness = createHarness();
    harness.repository.add(record({ executionId: "exec-1", startedAt: BASE }));
    harness.repository.add(
      record({
        executionId: "exec-2",
        startedAt: BASE + 60_000,
        completedAt: BASE + 102_000,
      }),
    );

    const history = await harness.runner.history("design-to-code");

    expect(history.map((entry) => entry.executionId)).toEqual([
      "exec-2",
      "exec-1",
    ]);
  });

  test("describes each run the way a person reads it", async () => {
    const harness = createHarness();
    harness.repository.add(record());
    feed(harness.collector, [
      event("execution.reconciled", 100, {
        added: 12,
        reused: 8,
        removed: 0,
        unchanged: 0,
      }),
    ]);

    const history = await harness.runner.history("design-to-code");

    expect(history[0]).toEqual({
      executionId: "exec-1",
      workflowId: "design-to-code",
      workflowName: "Design → Code",
      status: "completed",
      state: "ready",
      summary: "Design → Code finished — created 12, reused 8 artifacts.",
      startedAt: BASE,
      completedAt: BASE + 42_000,
      durationMs: 42_000,
      durationLabel: "42 seconds",
    });
  });

  test("includes runs that failed", async () => {
    const harness = createHarness();
    harness.repository.add(record({ status: "failed" }));

    const history = await harness.runner.history("design-to-code");

    expect(history[0]?.state).toBe("failed");
    expect(history[0]?.summary).toBe("Design → Code did not finish.");
  });

  test("returns nothing for a workflow that has never run", async () => {
    const harness = createHarness();

    expect(await harness.runner.history("never-run")).toEqual([]);
  });

  test("omits duration for a run still going", async () => {
    const harness = createHarness();
    harness.repository.add(
      record({ status: "running", completedAt: undefined }),
    );

    const history = await harness.runner.history("design-to-code");

    expect(history[0]?.durationLabel).toBeUndefined();
    expect(history[0]?.state).toBe("running");
  });
});

// ── Explain ─────────────────────────────────────────────────────

describe("explain", () => {
  test("returns the full Stage 27 report through the runner", async () => {
    const harness = createHarness();
    harness.repository.add(record());
    feed(harness.collector, [
      event("execution.started", 0),
      event("execution.completed", 42_000),
    ]);

    const report = await harness.runner.explain("exec-1");

    // One object a consumer can hold for everything — no second service to
    // wire up, and no engine imports.
    expect(report.overview.executionId).toBe("exec-1");
    expect(report.narration.map((entry) => entry.message)).toEqual([
      "Started workflow",
      "Completed successfully",
    ]);
    expect(report.timeline.entries).toHaveLength(2);
  });
});
