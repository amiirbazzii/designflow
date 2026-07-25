import type { WorkflowDefinition } from "@designflow/sdk";
import type { CompiledNode, CompiledWorkflow } from "./types";
import { CapabilityNotFoundError, WorkflowCompilationError } from "./errors";
import type { CapabilityRegistry } from "./registry";

export class WorkflowCompiler {
  private readonly registry: CapabilityRegistry;

  public constructor(registry: CapabilityRegistry) {
    this.registry = registry;
  }

  public compile(definition: WorkflowDefinition): CompiledWorkflow {
    const nodes = this.resolveNodes(definition);
    const ordered = this.topologicalSort(nodes);

    return {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      metadata: definition.metadata,
      nodes: ordered,
    };
  }

  private resolveNodes(definition: WorkflowDefinition): CompiledNode[] {
    return definition.nodes.map((node, index) => {
      const capability = this.registry.get(node.capabilityId);
      if (!capability) {
        throw new CapabilityNotFoundError(node.capabilityId, {
          workflowId: definition.id,
          nodeId: node.id,
        });
      }

      return { node, capability, order: index };
    });
  }

  private topologicalSort(nodes: CompiledNode[]): CompiledNode[] {
    const nodeMap = new Map<string, CompiledNode>();
    for (const n of nodes) {
      nodeMap.set(n.node.id, n);
    }

    const visited = new Set<string>();
    const result: CompiledNode[] = [];

    const visit = (nodeId: string, path: Set<string>): void => {
      if (visited.has(nodeId)) {
        return;
      }
      if (path.has(nodeId)) {
        throw new WorkflowCompilationError(
          `Circular dependency detected at node: ${nodeId}`,
          { nodeId },
        );
      }

      const compiled = nodeMap.get(nodeId);
      if (!compiled) {
        return;
      }

      path.add(nodeId);
      const dependencies = compiled.node.execution?.dependsOn ?? [];
      for (const dep of dependencies) {
        visit(dep, path);
      }
      path.delete(nodeId);

      visited.add(nodeId);
      result.push(compiled);
    };

    for (const node of nodes) {
      visit(node.node.id, new Set());
    }

    return result;
  }
}
