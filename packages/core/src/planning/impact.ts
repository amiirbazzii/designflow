import { nodeImpactSchema } from "@designflow/sdk";
import type { NodeImpact, WorkflowGraph } from "@designflow/sdk";
import { buildDependentIndex } from "./graph";

/**
 * Classifies every node in the graph against a change set.
 *
 * A node is affected when it produces a changed artifact
 * (`artifact_changed`), or when any node it depends on is affected
 * (`dependency_changed`). Propagation is transitive and runs forward from the
 * directly-hit nodes, so it terminates in one pass over the reachable set
 * regardless of graph depth.
 *
 * Results are returned in workflow declaration order, so a plan is stable
 * across runs.
 */
export function analyzeNodeImpact(
  workflow: WorkflowGraph,
  changedArtifacts: readonly string[],
): readonly NodeImpact[] {
  const changed = new Set(changedArtifacts);
  const dependents = buildDependentIndex(workflow);

  const direct = new Set<string>();
  const propagated = new Set<string>();

  for (const node of workflow.nodes) {
    if (node.produces.some((artifactId) => changed.has(artifactId))) {
      direct.add(node.id);
    }
  }

  // Forward closure from the directly-hit nodes. `seen` guards against
  // revisiting, so a diamond does not re-walk its tail and a malformed cyclic
  // graph cannot spin.
  const seen = new Set<string>(direct);
  let frontier: string[] = [...direct];

  while (frontier.length > 0) {
    const next: string[] = [];

    for (const nodeId of frontier) {
      for (const dependent of dependents.get(nodeId) ?? []) {
        if (seen.has(dependent)) continue;

        seen.add(dependent);
        propagated.add(dependent);
        next.push(dependent);
      }
    }

    frontier = next;
  }

  return workflow.nodes.map((node) => {
    // A node that both produces a changed artifact and sits downstream of
    // another affected node reports `artifact_changed`: the direct cause is
    // the more actionable one.
    const reason = direct.has(node.id)
      ? "artifact_changed"
      : propagated.has(node.id)
        ? "dependency_changed"
        : "unaffected";

    return nodeImpactSchema.parse({
      nodeId: node.id,
      affected: reason !== "unaffected",
      reason,
    });
  });
}
