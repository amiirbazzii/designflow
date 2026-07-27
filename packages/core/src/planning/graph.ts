import { workflowGraphSchema } from "@designflow/sdk";
import type { WorkflowDefinition, WorkflowGraph } from "@designflow/sdk";
import { ExecutionPlanningError } from "../errors";

/**
 * Reduces a workflow definition to the graph planning needs.
 *
 * Dependencies come from `execution.dependsOn` only — the same edge set the
 * `DagResolver` schedules on. Reading `next` here as well would let the
 * planner disagree with the executor about what runs after what.
 *
 * Dependencies naming a node that does not exist are dropped, matching the
 * resolver, which ignores them rather than failing the workflow.
 */
export function buildWorkflowGraph(
  definition: WorkflowDefinition,
): WorkflowGraph {
  const known = new Set<string>();

  for (const node of definition.nodes) {
    if (known.has(node.id)) {
      throw new ExecutionPlanningError("Duplicate node id in workflow", {
        workflowId: definition.id,
        nodeId: node.id,
      });
    }
    known.add(node.id);
  }

  return workflowGraphSchema.parse({
    workflowId: definition.id,
    nodes: definition.nodes.map((node) => ({
      id: node.id,
      dependencies: (node.execution?.dependsOn ?? []).filter((dep) =>
        known.has(dep),
      ),
      produces: node.produces ?? [],
    })),
  });
}

/** Node ids that depend directly on each node. */
export function buildDependentIndex(
  graph: WorkflowGraph,
): ReadonlyMap<string, readonly string[]> {
  const dependents = new Map<string, string[]>();

  for (const node of graph.nodes) {
    if (!dependents.has(node.id)) dependents.set(node.id, []);
  }

  for (const node of graph.nodes) {
    for (const dependency of node.dependencies) {
      const existing = dependents.get(dependency);
      if (existing === undefined) continue;
      existing.push(node.id);
    }
  }

  return dependents;
}
