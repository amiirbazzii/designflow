// packages/product/src/service.test.ts
import { describe, expect, test } from "bun:test";
import {
  type Artifact,
  type ArtifactLineageGraph,
  type ArtifactRegistry,
  type ArtifactVersion,
  type ExecutionEvent,
  type ExecutionRecord,
  type ExecutionRepository,
  DesignFlowError,
} from "@designflow/sdk";

import { ProductExecutionService, countArtifacts, formatDuration } from "./service";
import { InMemoryExecutionEventCollector } from "./event-collector";
import { narrateEvents } from "./narration";
import { buildTimeline } from "./timeline";

// ── Test Doubles ────────────────────────────────────────────────

/** Minimal repository holding records in memory. */
class StubRepository implements ExecutionRepository {
  private readonly records = new Map<string, ExecutionRecord>();

  public add(record: ExecutionRecord): void {
    this.records.set(record.executionId, record);
  }

  public async create(record: ExecutionRecord): Promise<void> {
    this.records.set(record.executionId, record);
  }

  public async update(): Promise<void> {}

  public async get(executionId: string): Promise<ExecutionRecord | null> {
    return this.records.get(executionId) ?? null;
  }

  public async list(workflowId: string): Promise<readonly ExecutionRecord[]> {
    return [...this.records.values()].filter(
      (record) => record.workflowId === workflowId,
    );
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

/** Registry holding artifacts and a fixed lineage per id. */
class StubRegistry implements ArtifactRegistry {
  private readonly artifacts = new Map<string, Artifact>();
  private readonly ancestors = new Map<string, readonly string[]>();

  public add(
    artifact: Pick<Artifact, "id" | "type"> & Partial<Artifact>,
    ancestors: readonly string[] = [],
  ): void {
    this.artifacts.set(artifact.id, {
      id: artifact.id,
      type: artifact.type,
      version: artifact.version ?? 1,
      createdAt: artifact.createdAt ?? 0,
      metadata: artifact.metadata ?? {},
      ...(artifact.provenance !== undefined
        ? { provenance: artifact.provenance }
        : {}),
    });
    this.ancestors.set(artifact.id, ancestors);
  }

  public async getArtifact(id: string): Promise<Artifact | null> {
    return this.artifacts.get(id) ?? null;
  }

  public async getLineage(artifactId: string): Promise<ArtifactLineageGraph> {
    const ancestors = this.ancestors.get(artifactId) ?? [];
    const nodes: Artifact[] = [];

    for (const id of [artifactId, ...ancestors]) {
      const artifact = this.artifacts.get(id);
      if (artifact !== undefined) nodes.push(artifact);
    }

    return {
      artifactId,
      nodes,
      relations: [],
      ancestors: [...ancestors],
      descendants: [],
    };
  }

  public async getVersion(): Promise<ArtifactVersion | null> {
    return null;
  }
  public async createArtifact(): Promise<Artifact> {
    throw new Error("read-only stub");
  }
  public async createVersion(): Promise<ArtifactVersion> {
    throw new Error("read-only stub");
  }
  public async addRelation(): Promise<void> {
    throw new Error("read-only stub");
  }
}

// ── Fixtures ────────────────────────────────────────────────────

const BASE = 1_700_000_000_000;

let eventSeq = 0;
const event = (
  type: ExecutionEvent["type"],
  offsetMs: number,
  payload?: Record<string, unknown>,
): ExecutionEvent => ({
  id: `evt-${eventSeq++}`,
  executionId: "exec-1",
  type,
  timestamp: BASE + offsetMs,
  ...(payload !== undefined ? { payload } : {}),
});

interface Harness {
  readonly service: ProductExecutionService;
  readonly repository: StubRepository;
  readonly registry: StubRegistry;
  readonly collector: InMemoryExecutionEventCollector;
}

const createHarness = (options?: {
  readonly workflowName?: string;
}): Harness => {
  const repository = new StubRepository();
  const registry = new StubRegistry();
  const collector = new InMemoryExecutionEventCollector();

  const service = new ProductExecutionService({
    executionRepository: repository,
    eventSource: collector,
    artifactRegistry: registry,
    ...(options?.workflowName !== undefined
      ? { resolveWorkflowName: () => options.workflowName }
      : {}),
  });

  return { service, repository, registry, collector };
};

const record = (
  overrides?: Partial<ExecutionRecord>,
): ExecutionRecord => ({
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
  for (const item of events) {
    void handler(item);
  }
};

/** A completed incremental run: 12 created, 8 reused, 2 removed. */
const incrementalRun = (): readonly ExecutionEvent[] => [
  event("execution.started", 0, { workflowId: "design-to-code" }),
  event("execution.planning", 500),
  event("execution.plan_created", 1_000, {
    workflowId: "design-to-code",
    affectedNodes: ["transform", "generate"],
    skippedNodes: ["parse"],
    executionNodes: ["transform", "generate"],
  }),
  event("execution.executing", 1_500),
  event("artifact.reused", 2_000, { artifactId: "ui-schema" }),
  event("artifact.reused", 2_100, { artifactId: "design-tokens" }),
  event("artifact.created", 3_000, { artifactId: "button", version: 1 }),
  event("execution.validating", 40_000),
  event("execution.reconciled", 41_000, {
    executionId: "exec-1",
    added: 12,
    reused: 8,
    removed: 2,
    unchanged: 0,
    removedArtifactIds: ["legacy-css"],
  }),
  event("execution.applying", 41_500),
  event("execution.completed", 42_000, { artifactCount: 20 }),
];

// ── 1. Completed execution summary ──────────────────────────────

describe("completed execution summary", () => {
  test("renders the overview a user reads", async () => {
    const harness = createHarness({ workflowName: "Design → Code" });
    harness.repository.add(record());
    feed(harness.collector, incrementalRun());

    const overview = await harness.service.getOverview("exec-1");

    expect(overview.workflowName).toBe("Design → Code");
    expect(overview.statusLabel).toBe("Completed");
    expect(overview.state).toBe("ready");
    expect(overview.durationLabel).toBe("42 seconds");
    expect(overview.artifacts.created).toBe(12);
    expect(overview.artifacts.reused).toBe(8);
    expect(overview.artifacts.removed).toBe(2);
  });

  test("summarizes what happened in one sentence", async () => {
    const harness = createHarness({ workflowName: "Design → Code" });
    harness.repository.add(record());
    feed(harness.collector, incrementalRun());

    const overview = await harness.service.getOverview("exec-1");

    expect(overview.summary).toBe(
      "Design → Code finished — created 12, reused 8, removed 2 artifacts.",
    );
  });

  test("falls back to the workflow id when no name resolver is given", async () => {
    const harness = createHarness();
    harness.repository.add(record());
    feed(harness.collector, incrementalRun());

    const overview = await harness.service.getOverview("exec-1");

    expect(overview.workflowName).toBe("design-to-code");
  });

  test("omits duration while the run is still going", async () => {
    const harness = createHarness();
    harness.repository.add(
      record({ status: "running", completedAt: undefined }),
    );
    feed(harness.collector, [event("execution.started", 0)]);

    const overview = await harness.service.getOverview("exec-1");

    expect(overview.state).toBe("running");
    expect(overview.durationLabel).toBeUndefined();
    expect(overview.summary).toBe("design-to-code is running.");
  });

  test("reports a run blocked on a person", async () => {
    const harness = createHarness();
    harness.repository.add(
      record({ status: "waiting_approval", completedAt: undefined }),
    );
    feed(harness.collector, [
      event("execution.waiting_approval", 100, { reason: "writes to main" }),
    ]);

    const overview = await harness.service.getOverview("exec-1");

    expect(overview.state).toBe("needs_approval");
    expect(overview.statusLabel).toBe("Waiting approval");
    expect(overview.summary).toContain("waiting for your approval");
  });

  test("rejects an unknown execution", async () => {
    const harness = createHarness();

    try {
      await harness.service.getOverview("missing");
      throw new Error("expected a rejection");
    } catch (error) {
      if (!(error instanceof DesignFlowError)) throw error;
      expect(error.code).toBe("ERR_EXECUTION_NOT_FOUND");
    }
  });

  test("formats durations at a human scale", () => {
    expect(formatDuration(420)).toBe("420 ms");
    expect(formatDuration(1_000)).toBe("1 second");
    expect(formatDuration(42_000)).toBe("42 seconds");
    expect(formatDuration(60_000)).toBe("1 minute");
    expect(formatDuration(125_000)).toBe("2 minutes 5 seconds");
  });
});

// ── 2. Failed execution summary ─────────────────────────────────

describe("failed execution summary", () => {
  test("reports the failure state and reason", async () => {
    const harness = createHarness({ workflowName: "Design → Code" });
    harness.repository.add(record({ status: "failed" }));
    feed(harness.collector, [
      event("execution.started", 0),
      event("execution.executing", 100),
      event("capability.failed", 200, { capabilityId: "cap-generate" }),
      event("execution.failed", 300, { reason: "validation_failed" }),
    ]);

    const overview = await harness.service.getOverview("exec-1");

    expect(overview.state).toBe("failed");
    expect(overview.statusLabel).toBe("Failed");
    expect(overview.failureReason).toBe("validation_failed");
    expect(overview.summary).toBe("Design → Code did not finish.");
  });

  test("falls back to the failed step when no reason is given", async () => {
    const harness = createHarness();
    harness.repository.add(record({ status: "failed" }));
    feed(harness.collector, [
      event("execution.failed", 300, { failedSteps: ["generate"] }),
    ]);

    const overview = await harness.service.getOverview("exec-1");

    expect(overview.failureReason).toBe("Failed at generate");
  });

  test("treats a cancelled run as failed for the reader", async () => {
    const harness = createHarness();
    harness.repository.add(record({ status: "cancelled" }));
    feed(harness.collector, [event("execution.cancelled", 100)]);

    const overview = await harness.service.getOverview("exec-1");

    expect(overview.state).toBe("failed");
  });

  test("narrates the failure", async () => {
    const harness = createHarness();
    harness.repository.add(record({ status: "failed" }));
    feed(harness.collector, [
      event("execution.started", 0),
      event("capability.failed", 200, { capabilityId: "cap-generate" }),
      event("execution.failed", 300, { reason: "validation_failed" }),
    ]);

    const narration = await harness.service.getNarration("exec-1");

    expect(narration.map((entry) => entry.message)).toEqual([
      "Started workflow",
      "Step failed: cap-generate",
      "Failed: validation_failed",
    ]);
  });
});

// ── 3. Reconciliation reporting ─────────────────────────────────

describe("reconciliation reporting", () => {
  test("prefers the reconciliation report over counted events", async () => {
    const harness = createHarness();
    harness.repository.add(record());
    feed(harness.collector, incrementalRun());

    const overview = await harness.service.getOverview("exec-1");

    // Three artifact events were seen, but the report is the engine's own
    // accounting and wins.
    expect(overview.artifacts.created).toBe(12);
    expect(overview.artifacts.total).toBe(20);
  });

  test("falls back to artifact events for a non-incremental run", () => {
    const counts = countArtifacts([
      event("artifact.created", 0, { artifactId: "a" }),
      event("artifact.created", 1, { artifactId: "b" }),
      event("artifact.reused", 2, { artifactId: "c" }),
    ]);

    expect(counts).toEqual({
      created: 2,
      reused: 1,
      removed: 0,
      unchanged: 0,
      total: 3,
    });
  });

  test("counts an artifact once even when it is emitted twice", () => {
    const counts = countArtifacts([
      event("artifact.created", 0, { artifactId: "a" }),
      event("artifact.created", 1, { artifactId: "a" }),
    ]);

    expect(counts.created).toBe(1);
  });

  test("counts a created-then-reused artifact as reused", () => {
    const counts = countArtifacts([
      event("artifact.created", 0, { artifactId: "a" }),
      event("artifact.reused", 1, { artifactId: "a" }),
    ]);

    expect(counts.created).toBe(0);
    expect(counts.reused).toBe(1);
  });

  test("narrates the reconciliation with its counts", async () => {
    const harness = createHarness();
    harness.repository.add(record());
    feed(harness.collector, incrementalRun());

    const narration = await harness.service.getNarration("exec-1");
    const line = narration.find((entry) => entry.kind === "reconciliation");

    expect(line?.message).toBe(
      "Validated final artifact state — 12 added, 8 reused, 2 removed",
    );
  });

  test("reports zero counts for a run that never reconciled", () => {
    expect(countArtifacts([])).toEqual({
      created: 0,
      reused: 0,
      removed: 0,
      unchanged: 0,
      total: 0,
    });
  });
});

// ── 4. Artifact reuse visibility ────────────────────────────────

describe("artifact reuse visibility", () => {
  test("presents a reused artifact the way a user reads it", async () => {
    const harness = createHarness();
    harness.repository.add(record());

    harness.registry.add({ id: "ui-schema", type: "schema" });
    harness.registry.add({ id: "design-tokens", type: "tokens" });
    harness.registry.add(
      {
        id: "button",
        type: "component",
        version: 3,
        metadata: { name: "Button Component" },
        provenance: {
          executionId: "exec-1",
          workflowId: "design-to-code",
          capabilityId: "Component Generator",
        },
      },
      ["ui-schema", "design-tokens"],
    );

    feed(harness.collector, [
      event("artifact.reused", 100, { artifactId: "button" }),
    ]);

    const artifacts = await harness.service.getArtifacts("exec-1");

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toEqual({
      artifactId: "button",
      name: "Button Component",
      type: "component",
      version: 3,
      status: "reused",
      createdBy: "Component Generator",
      dependencies: ["ui-schema", "design-tokens"],
    });
  });

  test("distinguishes created from reused artifacts", async () => {
    const harness = createHarness();
    harness.repository.add(record());
    harness.registry.add({ id: "ui-schema", type: "schema" });
    harness.registry.add({ id: "button", type: "component" });

    feed(harness.collector, [
      event("artifact.reused", 100, { artifactId: "ui-schema" }),
      event("artifact.created", 200, { artifactId: "button" }),
    ]);

    const artifacts = await harness.service.getArtifacts("exec-1");
    const byId = new Map(artifacts.map((a) => [a.artifactId, a.status]));

    expect(byId.get("ui-schema")).toBe("reused");
    expect(byId.get("button")).toBe("created");
  });

  test("shows a removed artifact from the reconciliation report", async () => {
    const harness = createHarness();
    harness.repository.add(record());
    harness.registry.add({ id: "legacy-css", type: "stylesheet" });

    feed(harness.collector, incrementalRun());

    const artifacts = await harness.service.getArtifacts("exec-1");
    const removed = artifacts.find((a) => a.artifactId === "legacy-css");

    // A removed artifact is absent from the final set, so only the report can
    // surface it.
    expect(removed?.status).toBe("removed");
  });

  test("falls back to the id when the producer named nothing", async () => {
    const harness = createHarness();
    harness.repository.add(record());
    harness.registry.add({ id: "raw-artifact", type: "blob" });

    feed(harness.collector, [
      event("artifact.created", 100, { artifactId: "raw-artifact" }),
    ]);

    const artifacts = await harness.service.getArtifacts("exec-1");

    expect(artifacts[0]?.name).toBe("raw-artifact");
    expect(artifacts[0]?.createdBy).toBeUndefined();
  });

  test("skips artifacts the registry does not know", async () => {
    const harness = createHarness();
    harness.repository.add(record());

    feed(harness.collector, [
      event("artifact.created", 100, { artifactId: "ghost" }),
    ]);

    expect(await harness.service.getArtifacts("exec-1")).toEqual([]);
  });

  test("returns nothing when no registry is configured", async () => {
    const repository = new StubRepository();
    repository.add(record());
    const collector = new InMemoryExecutionEventCollector();
    feed(collector, [event("artifact.created", 100, { artifactId: "a" })]);

    const service = new ProductExecutionService({
      executionRepository: repository,
      eventSource: collector,
    });

    expect(await service.getArtifacts("exec-1")).toEqual([]);
  });
});

// ── 5. Timeline ordering ────────────────────────────────────────

describe("timeline ordering", () => {
  test("orders entries by time with clock labels and offsets", async () => {
    const harness = createHarness();
    harness.repository.add(record());
    feed(harness.collector, incrementalRun());

    const timeline = await harness.service.getTimeline("exec-1");

    const offsets = timeline.entries.map((entry) => entry.offsetMs);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);

    expect(timeline.entries[0]?.offsetMs).toBe(0);
    expect(timeline.entries[0]?.label).toBe("Started workflow");
    expect(timeline.entries[0]?.at).toMatch(/^\d{2}:\d{2}$/);
  });

  test("keeps published order for events sharing a millisecond", () => {
    const timeline = buildTimeline(
      "exec-1",
      BASE,
      narrateEvents([
        event("execution.planning", 0),
        event("execution.executing", 0),
        event("execution.completed", 0),
      ]),
    );

    // Sorting alone would make same-millisecond order arbitrary; the engine's
    // publish order is the order the work actually happened.
    expect(timeline.entries.map((entry) => entry.label)).toEqual([
      "Planning workflow",
      "Running workflow steps",
      "Completed successfully",
    ]);
  });

  test("clamps an offset for an event stamped before the record started", () => {
    const timeline = buildTimeline(
      "exec-1",
      BASE + 5_000,
      narrateEvents([event("execution.started", 0)]),
    );

    expect(timeline.entries[0]?.offsetMs).toBe(0);
  });

  test("produces an empty timeline for an execution with no events", async () => {
    const harness = createHarness();
    harness.repository.add(record());

    const timeline = await harness.service.getTimeline("exec-1");

    expect(timeline.entries).toEqual([]);
    expect(timeline.startedAt).toBe(BASE);
  });
});

// ── Narration ───────────────────────────────────────────────────

describe("narration", () => {
  test("reads as a story a person can follow", async () => {
    const harness = createHarness();
    harness.repository.add(record());
    feed(harness.collector, incrementalRun());

    const narration = await harness.service.getNarration("exec-1");

    expect(narration.map((entry) => entry.message)).toEqual([
      "Started workflow",
      "Planning workflow",
      "Analyzed dependencies — 2 steps to run, 1 up to date",
      "Running workflow steps",
      "Reused 2 existing artifacts",
      "Generated 1 new artifact",
      "Validating results",
      "Validated final artifact state — 12 added, 8 reused, 2 removed",
      "Applying results",
      "Completed successfully",
    ]);
  });

  test("aggregates a run of identical artifact events into one line", () => {
    const narration = narrateEvents([
      event("artifact.reused", 0, { artifactId: "a" }),
      event("artifact.reused", 1, { artifactId: "b" }),
      event("artifact.reused", 2, { artifactId: "c" }),
    ]);

    expect(narration).toHaveLength(1);
    expect(narration[0]?.message).toBe("Reused 3 existing artifacts");
    expect(narration[0]?.timestamp).toBe(BASE);
    expect(narration[0]?.sourceEventTypes).toHaveLength(3);
  });

  test("suppresses events that would only add noise", () => {
    const narration = narrateEvents([
      event("artifact.version_created", 0, { artifactId: "a" }),
      event("artifact.relation_added", 1, { artifactId: "a" }),
      event("artifact.materialized", 2, { artifactId: "a" }),
    ]);

    // Raw events are untouched; they simply do not appear in the story.
    expect(narration).toEqual([]);
  });

  test("keeps the raw event types it derived each line from", () => {
    const narration = narrateEvents([event("execution.planning", 0)]);

    expect(narration[0]?.sourceEventTypes).toEqual(["execution.planning"]);
  });

  test("narrates approval gates", () => {
    const narration = narrateEvents([
      event("execution.waiting_approval", 0, { reason: "writes to main" }),
      event("execution.approval_approved", 1),
    ]);

    expect(narration.map((entry) => entry.message)).toEqual([
      "Waiting for approval — writes to main",
      "Approved, resuming",
    ]);
    expect(narration.every((entry) => entry.kind === "approval")).toBe(true);
  });

  test("narrates a plan where nothing was skipped", () => {
    const narration = narrateEvents([
      event("execution.plan_created", 0, {
        affectedNodes: ["a"],
        skippedNodes: [],
        executionNodes: ["a"],
      }),
    ]);

    expect(narration[0]?.message).toBe("Analyzed dependencies — 1 step to run");
  });
});

// ── Full report ─────────────────────────────────────────────────

describe("getReport", () => {
  test("answers why the workflow produced this result", async () => {
    const harness = createHarness({ workflowName: "Design → Code" });
    harness.repository.add(record());
    harness.registry.add({ id: "ui-schema", type: "schema" });
    harness.registry.add({ id: "design-tokens", type: "tokens" });
    harness.registry.add({ id: "button", type: "component" });
    harness.registry.add({ id: "legacy-css", type: "stylesheet" });

    feed(harness.collector, incrementalRun());

    const report = await harness.service.getReport("exec-1");

    expect(report.overview.state).toBe("ready");
    expect(report.narration.length).toBeGreaterThan(0);
    expect(report.timeline.entries.length).toBe(report.narration.length);
    expect(report.artifacts.map((a) => a.status).sort()).toEqual([
      "created",
      "removed",
      "reused",
      "reused",
    ]);
  });

  test("lists a workflow's executions newest first", async () => {
    const harness = createHarness();
    harness.repository.add(record({ executionId: "exec-1", startedAt: BASE }));
    harness.repository.add(
      record({ executionId: "exec-2", startedAt: BASE + 10_000 }),
    );

    const overviews = await harness.service.listOverviews("design-to-code");

    expect(overviews.map((o) => o.executionId)).toEqual(["exec-2", "exec-1"]);
  });
});

// ── Event collector ─────────────────────────────────────────────

describe("InMemoryExecutionEventCollector", () => {
  test("keeps events per execution in publish order", async () => {
    const collector = new InMemoryExecutionEventCollector();
    const handler = collector.createHandler();

    void handler(event("execution.started", 0));
    void handler({ ...event("execution.completed", 1), executionId: "other" });
    void handler(event("execution.completed", 2));

    const events = await collector.listEvents("exec-1");
    expect(events.map((e) => e.type)).toEqual([
      "execution.started",
      "execution.completed",
    ]);
    expect(await collector.listEvents("other")).toHaveLength(1);
  });

  test("returns an empty list for an unknown execution", async () => {
    const collector = new InMemoryExecutionEventCollector();

    expect(await collector.listEvents("nothing")).toEqual([]);
  });

  test("hands out a copy so callers cannot mutate the store", async () => {
    const collector = new InMemoryExecutionEventCollector();
    void collector.createHandler()(event("execution.started", 0));

    const first = await collector.listEvents("exec-1");
    expect(first).not.toBe(await collector.listEvents("exec-1"));
  });

  test("forgets an execution's presentation detail on request", async () => {
    const collector = new InMemoryExecutionEventCollector();
    void collector.createHandler()(event("execution.started", 0));

    collector.forget("exec-1");

    expect(await collector.listEvents("exec-1")).toEqual([]);
  });
});

// ── Phase 9: structured failure facts on the overview ───────────

describe("Phase 9 overview failure facts", () => {
  test("a failed run exposes errorCode, failed capability, and bounded attempt diagnostics", async () => {
    const harness = createHarness();
    harness.repository.add(record({ status: "failed" }));
    feed(harness.collector, [
      event("execution.started", 0, { workflowId: "design-to-code" }),
      event("capability.failed", 900, {
        capabilityId: "invoke-implementation-agent",
        attempt: 1,
        error: "The proposal remained invalid after 3 bounded attempts",
        errorCode: "ERR_PROPOSAL_ATTEMPTS_EXHAUSTED",
        attemptDiagnostics: [
          { attempt: 1, code: "ERR_UNSAFE_PATH", message: "unsafe", path: "../x.jsx", operation: "create" },
          { attempt: 2, code: "ERR_PROPOSAL_TARGET_EXISTS", message: "exists", path: "src/App.jsx", operation: "create" },
        ],
      }),
      event("execution.failed", 1000, {
        workflowId: "design-to-code",
        errorCode: "ERR_PROPOSAL_ATTEMPTS_EXHAUSTED",
        reason: "The proposal remained invalid after 3 bounded attempts",
        attemptDiagnostics: [
          { attempt: 1, code: "ERR_UNSAFE_PATH", message: "unsafe", path: "../x.jsx", operation: "create" },
          { attempt: 2, code: "ERR_PROPOSAL_TARGET_EXISTS", message: "exists", path: "src/App.jsx", operation: "create" },
        ],
      }),
    ]);

    const overview = await harness.service.getOverview("exec-1");

    expect(overview.failure).toBeDefined();
    expect(overview.failure!.errorCode).toBe("ERR_PROPOSAL_ATTEMPTS_EXHAUSTED");
    expect(overview.failure!.failedCapabilityId).toBe("invoke-implementation-agent");
    expect(overview.failure!.attemptDiagnostics!.map((d) => d.attempt)).toEqual([1, 2]);
    expect(overview.failure!.attemptDiagnostics![0]!.path).toBe("../x.jsx");
  });

  test("a completed run has no failure facts", async () => {
    const harness = createHarness();
    harness.repository.add(record());
    feed(harness.collector, incrementalRun());
    const overview = await harness.service.getOverview("exec-1");
    expect(overview.failure).toBeUndefined();
  });
});
