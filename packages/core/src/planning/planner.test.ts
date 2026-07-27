import { describe, expect, test } from "bun:test";
import type {
  ExecutionRecord,
  WorkflowDefinition,
  WorkflowGraph,
} from "@designflow/sdk";
import { DesignFlowError, workflowDefinitionSchema } from "@designflow/sdk";
import { IncrementalExecutionPlannerService } from "./planner";
import { buildDependentIndex, buildWorkflowGraph } from "./graph";
import { analyzeNodeImpact } from "./impact";
import { InMemoryExecutionRepository } from "../repository";

// ── Fixtures ────────────────────────────────────────────────────

/**
 * parse -> transform -> generate -> validate, each declaring its output.
 *
 *   parse     produces figma-json
 *   transform produces ui-ir
 *   generate  produces generated-code
 *   validate  produces validated-patch
 */
const pipeline: WorkflowDefinition = workflowDefinitionSchema.parse({
  id: "design-to-code",
  name: "design to code",
  nodes: [
    { id: "parse", capabilityId: "cap-parse", produces: ["figma-json"] },
    {
      id: "transform",
      capabilityId: "cap-transform",
      produces: ["ui-ir"],
      execution: { dependsOn: ["parse"] },
    },
    {
      id: "generate",
      capabilityId: "cap-generate",
      produces: ["generated-code"],
      execution: { dependsOn: ["transform"] },
    },
    {
      id: "validate",
      capabilityId: "cap-validate",
      produces: ["validated-patch"],
      execution: { dependsOn: ["generate"] },
    },
  ],
});

const createPlanner = (options?: {
  readonly definition?: WorkflowDefinition;
  readonly repository?: InMemoryExecutionRepository;
}): IncrementalExecutionPlannerService => {
  const definition = options?.definition ?? pipeline;

  return new IncrementalExecutionPlannerService({
    resolveWorkflow: (workflowId) =>
      workflowId === definition.id ? definition : undefined,
    ...(options?.repository !== undefined
      ? { executionRepository: options.repository }
      : {}),
  });
};

const seedExecution = async (
  repository: InMemoryExecutionRepository,
  executionId: string,
): Promise<void> => {
  const record: ExecutionRecord = {
    executionId,
    workflowId: pipeline.id,
    status: "completed",
    startedAt: Date.now(),
  };
  await repository.create(record);
};

const reasonFor = (
  impacts: readonly { nodeId: string; reason: string }[],
  nodeId: string,
): string | undefined =>
  impacts.find((impact) => impact.nodeId === nodeId)?.reason;

// ── 1. Workflow graph creation ──────────────────────────────────

describe("buildWorkflowGraph", () => {
  test("reduces a definition to ids, dependencies and produces", () => {
    const graph = buildWorkflowGraph(pipeline);

    expect(graph.workflowId).toBe("design-to-code");
    expect(graph.nodes.map((node) => node.id)).toEqual([
      "parse",
      "transform",
      "generate",
      "validate",
    ]);
    expect(graph.nodes[0]).toEqual({
      id: "parse",
      dependencies: [],
      produces: ["figma-json"],
    });
    expect(graph.nodes[2]?.dependencies).toEqual(["transform"]);
  });

  test("defaults produces for a node that declares none", () => {
    const graph = buildWorkflowGraph(
      workflowDefinitionSchema.parse({
        id: "wf",
        name: "wf",
        nodes: [{ id: "a", capabilityId: "cap-a" }],
      }),
    );

    expect(graph.nodes[0]?.produces).toEqual([]);
  });

  test("drops dependencies naming a node that does not exist", () => {
    const graph = buildWorkflowGraph(
      workflowDefinitionSchema.parse({
        id: "wf",
        name: "wf",
        nodes: [
          { id: "a", capabilityId: "cap-a" },
          {
            id: "b",
            capabilityId: "cap-b",
            execution: { dependsOn: ["a", "ghost"] },
          },
        ],
      }),
    );

    // Matches the DagResolver, which ignores unknown dependencies rather than
    // failing the workflow.
    expect(graph.nodes[1]?.dependencies).toEqual(["a"]);
  });

  test("ignores `next` so the planner cannot disagree with the executor", () => {
    const graph = buildWorkflowGraph(
      workflowDefinitionSchema.parse({
        id: "wf",
        name: "wf",
        nodes: [
          { id: "a", capabilityId: "cap-a", next: ["b"] },
          { id: "b", capabilityId: "cap-b" },
        ],
      }),
    );

    expect(graph.nodes[1]?.dependencies).toEqual([]);
  });

  test("rejects a duplicate node id", () => {
    expect(() =>
      buildWorkflowGraph(
        workflowDefinitionSchema.parse({
          id: "wf",
          name: "wf",
          nodes: [
            { id: "a", capabilityId: "cap-a" },
            { id: "a", capabilityId: "cap-b" },
          ],
        }),
      ),
    ).toThrow(DesignFlowError);
  });

  test("indexes dependents for every node", () => {
    const dependents = buildDependentIndex(buildWorkflowGraph(pipeline));

    expect(dependents.get("parse")).toEqual(["transform"]);
    expect(dependents.get("transform")).toEqual(["generate"]);
    expect(dependents.get("validate")).toEqual([]);
  });
});

// ── 2. Direct artifact impact ───────────────────────────────────

describe("direct artifact impact", () => {
  test("marks the producing node artifact_changed", () => {
    const impacts = analyzeNodeImpact(buildWorkflowGraph(pipeline), ["ui-ir"]);

    expect(reasonFor(impacts, "transform")).toBe("artifact_changed");
    expect(
      impacts.find((impact) => impact.nodeId === "transform")?.affected,
    ).toBe(true);
  });

  test("marks the root node when its own artifact changes", () => {
    const impacts = analyzeNodeImpact(buildWorkflowGraph(pipeline), [
      "figma-json",
    ]);

    expect(reasonFor(impacts, "parse")).toBe("artifact_changed");
    expect(impacts.every((impact) => impact.affected)).toBe(true);
  });

  test("prefers the direct cause when a node is hit both ways", () => {
    const impacts = analyzeNodeImpact(buildWorkflowGraph(pipeline), [
      "figma-json",
      "generated-code",
    ]);

    // generate produces a changed artifact *and* sits downstream of parse.
    expect(reasonFor(impacts, "generate")).toBe("artifact_changed");
  });

  test("ignores an artifact no node declares", () => {
    const impacts = analyzeNodeImpact(buildWorkflowGraph(pipeline), [
      "unrelated",
    ]);

    expect(impacts.every((impact) => !impact.affected)).toBe(true);
  });
});

// ── 3. Dependency propagation ───────────────────────────────────

describe("dependency propagation", () => {
  test("propagates transitively down the chain", () => {
    const impacts = analyzeNodeImpact(buildWorkflowGraph(pipeline), ["ui-ir"]);

    expect(reasonFor(impacts, "generate")).toBe("dependency_changed");
    expect(reasonFor(impacts, "validate")).toBe("dependency_changed");
  });

  test("does not propagate upstream", () => {
    const impacts = analyzeNodeImpact(buildWorkflowGraph(pipeline), [
      "generated-code",
    ]);

    expect(reasonFor(impacts, "parse")).toBe("unaffected");
    expect(reasonFor(impacts, "transform")).toBe("unaffected");
    expect(reasonFor(impacts, "validate")).toBe("dependency_changed");
  });

  test("propagates across a diamond without revisiting", () => {
    const diamond = workflowDefinitionSchema.parse({
      id: "wf-diamond",
      name: "diamond",
      nodes: [
        { id: "a", capabilityId: "cap-a", produces: ["art-a"] },
        {
          id: "b",
          capabilityId: "cap-b",
          execution: { dependsOn: ["a"] },
        },
        {
          id: "c",
          capabilityId: "cap-c",
          execution: { dependsOn: ["a"] },
        },
        {
          id: "d",
          capabilityId: "cap-d",
          execution: { dependsOn: ["b", "c"] },
        },
      ],
    });

    const impacts = analyzeNodeImpact(buildWorkflowGraph(diamond), ["art-a"]);

    expect(impacts.map((impact) => impact.nodeId)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(impacts.every((impact) => impact.affected)).toBe(true);
    expect(reasonFor(impacts, "d")).toBe("dependency_changed");
  });

  test("leaves a parallel branch untouched", () => {
    const branched = workflowDefinitionSchema.parse({
      id: "wf-branch",
      name: "branch",
      nodes: [
        { id: "tokens", capabilityId: "cap-tokens", produces: ["tokens"] },
        { id: "icons", capabilityId: "cap-icons", produces: ["icons"] },
        {
          id: "css",
          capabilityId: "cap-css",
          execution: { dependsOn: ["tokens"] },
        },
        {
          id: "sprite",
          capabilityId: "cap-sprite",
          execution: { dependsOn: ["icons"] },
        },
      ],
    });

    const impacts = analyzeNodeImpact(buildWorkflowGraph(branched), ["tokens"]);

    expect(reasonFor(impacts, "css")).toBe("dependency_changed");
    expect(reasonFor(impacts, "icons")).toBe("unaffected");
    expect(reasonFor(impacts, "sprite")).toBe("unaffected");
  });
});

// ── 4. Multiple changed artifacts ───────────────────────────────

describe("multiple changed artifacts", () => {
  test("unions the impact of every change", () => {
    const branched = workflowDefinitionSchema.parse({
      id: "wf-branch",
      name: "branch",
      nodes: [
        { id: "tokens", capabilityId: "cap-tokens", produces: ["tokens"] },
        { id: "icons", capabilityId: "cap-icons", produces: ["icons"] },
        {
          id: "css",
          capabilityId: "cap-css",
          execution: { dependsOn: ["tokens"] },
        },
        {
          id: "sprite",
          capabilityId: "cap-sprite",
          execution: { dependsOn: ["icons"] },
        },
      ],
    });

    const impacts = analyzeNodeImpact(buildWorkflowGraph(branched), [
      "tokens",
      "icons",
    ]);

    expect(impacts.every((impact) => impact.affected)).toBe(true);
    expect(reasonFor(impacts, "tokens")).toBe("artifact_changed");
    expect(reasonFor(impacts, "icons")).toBe("artifact_changed");
  });

  test("handles a node declaring several artifacts", () => {
    const multi = workflowDefinitionSchema.parse({
      id: "wf-multi",
      name: "multi",
      nodes: [
        {
          id: "emit",
          capabilityId: "cap-emit",
          produces: ["one", "two", "three"],
        },
        {
          id: "after",
          capabilityId: "cap-after",
          execution: { dependsOn: ["emit"] },
        },
      ],
    });

    const impacts = analyzeNodeImpact(buildWorkflowGraph(multi), ["two"]);

    expect(reasonFor(impacts, "emit")).toBe("artifact_changed");
    expect(reasonFor(impacts, "after")).toBe("dependency_changed");
  });

  test("deduplicates overlapping impact", () => {
    const impacts = analyzeNodeImpact(buildWorkflowGraph(pipeline), [
      "ui-ir",
      "generated-code",
    ]);

    expect(impacts).toHaveLength(4);
    expect(reasonFor(impacts, "validate")).toBe("dependency_changed");
  });
});

// ── 5. Unaffected node detection ────────────────────────────────

describe("unaffected node detection", () => {
  test("reports upstream nodes as unaffected", () => {
    const impacts = analyzeNodeImpact(buildWorkflowGraph(pipeline), ["ui-ir"]);

    const parse = impacts.find((impact) => impact.nodeId === "parse");
    expect(parse?.affected).toBe(false);
    expect(parse?.reason).toBe("unaffected");
  });

  test("reports every node unaffected for an empty change set", () => {
    const impacts = analyzeNodeImpact(buildWorkflowGraph(pipeline), []);

    expect(impacts.every((impact) => !impact.affected)).toBe(true);
  });

  test("returns impacts in workflow declaration order", () => {
    const impacts = analyzeNodeImpact(buildWorkflowGraph(pipeline), ["ui-ir"]);

    expect(impacts.map((impact) => impact.nodeId)).toEqual([
      "parse",
      "transform",
      "generate",
      "validate",
    ]);
  });
});

// ── 6. Reusable node classification ─────────────────────────────

describe("resolveReusableNodes", () => {
  test("classifies unaffected nodes as reusable", () => {
    const planner = createPlanner();
    const graph: WorkflowGraph = buildWorkflowGraph(pipeline);
    const impacts = analyzeNodeImpact(graph, ["ui-ir"]);

    expect(planner.resolveReusableNodes(graph, impacts)).toEqual(["parse"]);
  });

  test("classifies nothing reusable when everything is affected", () => {
    const planner = createPlanner();
    const graph = buildWorkflowGraph(pipeline);
    const impacts = analyzeNodeImpact(graph, ["figma-json"]);

    expect(planner.resolveReusableNodes(graph, impacts)).toEqual([]);
  });

  test("ignores impacts for nodes not in the graph", () => {
    const planner = createPlanner();
    const graph = buildWorkflowGraph(pipeline);

    const reusable = planner.resolveReusableNodes(graph, [
      { nodeId: "parse", affected: false, reason: "unaffected" },
      { nodeId: "ghost", affected: false, reason: "unaffected" },
    ]);

    expect(reusable).toEqual(["parse"]);
  });

  test("treats nothing as reusable without a previous execution", async () => {
    const planner = createPlanner();

    const result = await planner.planExecution({
      workflowId: "design-to-code",
      changedArtifacts: ["ui-ir"],
    });

    // Nothing exists to reuse, so the plan degrades to a full run rather than
    // skipping work that was never done.
    expect(result.plan.reusableNodes).toEqual([]);
    expect(result.plan.skippedNodes).toEqual([]);
    expect(result.plan.executionNodes).toHaveLength(4);
    expect(result.plan.affectedNodes).toHaveLength(3);
  });

  test("treats nothing as reusable when the previous execution is unknown", async () => {
    const repository = new InMemoryExecutionRepository();
    const planner = createPlanner({ repository });

    const result = await planner.planExecution({
      workflowId: "design-to-code",
      changedArtifacts: ["ui-ir"],
      previousExecutionId: "never-happened",
    });

    expect(result.plan.reusableNodes).toEqual([]);
    expect(result.plan.executionNodes).toHaveLength(4);
  });
});

// ── 7. Minimal execution plan ───────────────────────────────────

describe("planExecution", () => {
  test("produces the minimal plan for a mid-chain change", async () => {
    const repository = new InMemoryExecutionRepository();
    await seedExecution(repository, "exec-1");
    const planner = createPlanner({ repository });

    const result = await planner.planExecution({
      workflowId: "design-to-code",
      changedArtifacts: ["ui-ir"],
      previousExecutionId: "exec-1",
    });

    expect(result.plan).toEqual({
      workflowId: "design-to-code",
      changedArtifacts: ["ui-ir"],
      affectedNodes: ["transform", "generate", "validate"],
      reusableNodes: ["parse"],
      executionNodes: ["transform", "generate", "validate"],
      skippedNodes: ["parse"],
    });
  });

  test("returns the node impacts alongside the plan", async () => {
    const repository = new InMemoryExecutionRepository();
    await seedExecution(repository, "exec-1");
    const planner = createPlanner({ repository });

    const result = await planner.planExecution({
      workflowId: "design-to-code",
      changedArtifacts: ["ui-ir"],
      previousExecutionId: "exec-1",
    });

    expect(result.nodeImpacts).toHaveLength(4);
    expect(reasonFor(result.nodeImpacts, "parse")).toBe("unaffected");
    expect(reasonFor(result.nodeImpacts, "transform")).toBe("artifact_changed");
  });

  test("execution and skipped nodes partition the workflow", async () => {
    const repository = new InMemoryExecutionRepository();
    await seedExecution(repository, "exec-1");
    const planner = createPlanner({ repository });

    const result = await planner.planExecution({
      workflowId: "design-to-code",
      changedArtifacts: ["generated-code"],
      previousExecutionId: "exec-1",
    });

    const all = [
      ...result.plan.executionNodes,
      ...result.plan.skippedNodes,
    ].sort();

    expect(all).toEqual(["generate", "parse", "transform", "validate"]);
    expect(
      result.plan.executionNodes.filter((id) =>
        result.plan.skippedNodes.includes(id),
      ),
    ).toEqual([]);
  });

  test("runs everything when the root artifact changes", async () => {
    const repository = new InMemoryExecutionRepository();
    await seedExecution(repository, "exec-1");
    const planner = createPlanner({ repository });

    const result = await planner.planExecution({
      workflowId: "design-to-code",
      changedArtifacts: ["figma-json"],
      previousExecutionId: "exec-1",
    });

    expect(result.plan.executionNodes).toHaveLength(4);
    expect(result.plan.skippedNodes).toEqual([]);
  });

  test("rejects an unknown workflow", async () => {
    const planner = createPlanner();

    try {
      await planner.planExecution({ workflowId: "missing" });
      throw new Error("expected a planning error");
    } catch (error) {
      expect(error).toBeInstanceOf(DesignFlowError);
      expect(error instanceof DesignFlowError ? error.code : "").toBe(
        "ERR_EXECUTION_PLANNING",
      );
    }
  });

  test("takes a previous execution id on trust with no repository", async () => {
    const planner = createPlanner();

    const result = await planner.planExecution({
      workflowId: "design-to-code",
      changedArtifacts: ["ui-ir"],
      previousExecutionId: "exec-unverified",
    });

    expect(result.plan.skippedNodes).toEqual(["parse"]);
  });
});

// ── 8. Empty change set ─────────────────────────────────────────

describe("empty change set", () => {
  test("skips everything when a previous execution exists", async () => {
    const repository = new InMemoryExecutionRepository();
    await seedExecution(repository, "exec-1");
    const planner = createPlanner({ repository });

    const result = await planner.planExecution({
      workflowId: "design-to-code",
      changedArtifacts: [],
      previousExecutionId: "exec-1",
    });

    expect(result.plan.affectedNodes).toEqual([]);
    expect(result.plan.executionNodes).toEqual([]);
    expect(result.plan.skippedNodes).toHaveLength(4);
  });

  test("runs everything on a first execution", async () => {
    const planner = createPlanner();

    const result = await planner.planExecution({
      workflowId: "design-to-code",
      changedArtifacts: [],
    });

    // No change set and no prior run is a cold start, not a no-op.
    expect(result.plan.executionNodes).toHaveLength(4);
    expect(result.plan.skippedNodes).toEqual([]);
  });

  test("defaults an omitted change set to empty", async () => {
    const repository = new InMemoryExecutionRepository();
    await seedExecution(repository, "exec-1");
    const planner = createPlanner({ repository });

    const result = await planner.planExecution({
      workflowId: "design-to-code",
      previousExecutionId: "exec-1",
    });

    expect(result.plan.changedArtifacts).toEqual([]);
    expect(result.plan.executionNodes).toEqual([]);
  });

  test("plans an empty workflow without failing", async () => {
    const empty = workflowDefinitionSchema.parse({
      id: "wf-empty",
      name: "empty",
      nodes: [],
    });

    const planner = new IncrementalExecutionPlannerService({
      resolveWorkflow: () => empty,
    });

    const result = await planner.planExecution({ workflowId: "wf-empty" });

    expect(result.plan.executionNodes).toEqual([]);
    expect(result.plan.skippedNodes).toEqual([]);
    expect(result.nodeImpacts).toEqual([]);
  });
});
