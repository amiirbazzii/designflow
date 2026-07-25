import type { CapabilityNode, WorkflowDefinition } from "@designflow/sdk";
import { ExecutionError } from "./errors";
import type { ExecutionLayer, ExecutionPlan, ExecutionStep } from "./types";

export class DagResolver {
  public resolve(definition: WorkflowDefinition): ExecutionPlan {
    const { nodes } = definition;

    const nodeMap = new Map<string, CapabilityNode>();
    for (const node of nodes) {
      nodeMap.set(node.id, node);
    }

    const cycleNodes = this.detectCycle(nodes, nodeMap);
    if (cycleNodes !== null) {
      throw new ExecutionError("Circular dependency detected", {
        workflowId: definition.id,
        cycleNodes,
      });
    }

    const layers = this.computeLayers(nodes, nodeMap);

    const mutableSteps: ExecutionStep[] = [];
    for (const layer of layers) {
      for (const nodeId of layer.nodeIds) {
        const node = nodeMap.get(nodeId)!;
        mutableSteps.push({
          nodeId: node.id,
          capabilityId: node.capabilityId,
          label: node.label,
          inputMap: node.inputMap,
          dependsOn: node.execution?.dependsOn ?? [],
        });
      }
    }

    return {
      workflowId: definition.id,
      layers: layers.map((layer, index) => ({
        index,
        nodeIds: layer.nodeIds,
      })),
      steps: mutableSteps,
      totalSteps: mutableSteps.length,
    };
  }

  private detectCycle(
    nodes: readonly CapabilityNode[],
    nodeMap: Map<string, CapabilityNode>,
  ): string[] | null {
    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;

    const color = new Map<string, number>();
    for (const node of nodes) {
      color.set(node.id, WHITE);
    }

    const parent = new Map<string, string>();

    const dfs = (nodeId: string): string[] | null => {
      color.set(nodeId, GRAY);

      const node = nodeMap.get(nodeId);
      const deps = node?.execution?.dependsOn ?? [];

      for (const dep of deps) {
        if (!nodeMap.has(dep)) continue;

        const depColor = color.get(dep)!;

        if (depColor === GRAY) {
          const cycle: string[] = [nodeId];
          let current: string = nodeId;
          while (current !== dep) {
            current = parent.get(current)!;
            cycle.push(current);
          }
          cycle.reverse();
          return cycle;
        }

        if (depColor === WHITE) {
          parent.set(dep, nodeId);
          const result = dfs(dep);
          if (result !== null) return result;
        }
      }

      color.set(nodeId, BLACK);
      return null;
    };

    for (const node of nodes) {
      if (color.get(node.id) === WHITE) {
        const cycle = dfs(node.id);
        if (cycle !== null) return cycle;
      }
    }

    return null;
  }

  private computeLayers(
    nodes: readonly CapabilityNode[],
    nodeMap: Map<string, CapabilityNode>,
  ): ExecutionLayer[] {
    const nodeIndex = new Map<string, number>();
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node) {
        nodeIndex.set(node.id, i);
      }
    }

    const inDegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();

    for (const node of nodes) {
      inDegree.set(node.id, 0);
      dependents.set(node.id, []);
    }

    for (const node of nodes) {
      const deps = node.execution?.dependsOn ?? [];
      const existingDeps = deps.filter((d) => nodeMap.has(d));
      inDegree.set(node.id, existingDeps.length);
      for (const dep of existingDeps) {
        dependents.get(dep)!.push(node.id);
      }
    }

    const layers: ExecutionLayer[] = [];
    const processed = new Set<string>();

    let currentLayerNodes: string[] = nodes
      .filter((n) => inDegree.get(n.id) === 0)
      .map((n) => n.id);

    this.sortByWorkflowOrder(currentLayerNodes, nodeIndex);

    let layerIndex = 0;

    while (currentLayerNodes.length > 0) {
      layers.push({ index: layerIndex, nodeIds: [...currentLayerNodes] });
      for (const nodeId of currentLayerNodes) {
        processed.add(nodeId);
      }

      const nextLayerNodes: string[] = [];
      for (const nodeId of currentLayerNodes) {
        const children = dependents.get(nodeId) ?? [];
        for (const childId of children) {
          const newDegree = (inDegree.get(childId) ?? 1) - 1;
          inDegree.set(childId, newDegree);
          if (newDegree === 0 && !processed.has(childId)) {
            nextLayerNodes.push(childId);
          }
        }
      }

      this.sortByWorkflowOrder(nextLayerNodes, nodeIndex);

      currentLayerNodes = nextLayerNodes;
      layerIndex++;
    }

    return layers;
  }

  private sortByWorkflowOrder(
    nodeIds: string[],
    nodeIndex: Map<string, number>,
  ): void {
    nodeIds.sort(
      (a, b) => (nodeIndex.get(a) ?? Infinity) - (nodeIndex.get(b) ?? Infinity),
    );
  }
}
