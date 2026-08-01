// packages/core/src/compiler.ts
import {
  type WorkflowDefinition,
  isWorkflowNode,
} from "@designflow/sdk";

import type { CompiledNode, CompiledWorkflow, ExecutionPlan } from "./types";
import { CapabilityNotFoundError, WorkflowCompilationError } from "./errors";
import type { CapabilityRegistry } from "./registry";
import { DagResolver } from "./dag";

export interface CompilationResult {
  readonly compiled: CompiledWorkflow;
  readonly plan: ExecutionPlan;
}

export class WorkflowCompiler {
  private readonly registry: CapabilityRegistry;
  private readonly dagResolver: DagResolver;

  public constructor(registry: CapabilityRegistry) {
    this.registry = registry;
    this.dagResolver = new DagResolver();
  }

  public compile(definition: WorkflowDefinition): CompilationResult {
    const nodes = this.resolveNodes(definition);
    const ordered = this.topologicalSort(nodes);
    const plan = this.dagResolver.resolve(definition);

    return {
      compiled: {
        id: definition.id,
        name: definition.name,
        description: definition.description,
        metadata: definition.metadata,
        nodes: ordered,
      },
      plan,
    };
  }

  private resolveNodes(definition: WorkflowDefinition): CompiledNode[] {
    return definition.nodes.map((node, index): CompiledNode => {
      // Child workflow nodes are resolved at execution time by the injected
      // WorkflowExecutionResolver — core never statically resolves workflows.
      if (isWorkflowNode(node)) {
        return { kind: "workflow", node, order: index };
      }

      const capability = this.registry.get(node.capabilityId);
      if (!capability) {
        throw new CapabilityNotFoundError(node.capabilityId, {
          workflowId: definition.id,
          nodeId: node.id,
        });
      }

      return { kind: "capability", node, capability, order: index };
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