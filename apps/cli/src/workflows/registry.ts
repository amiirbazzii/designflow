// apps/cli/src/workflows/registry.ts
import { workflowPackageSchema, DesignFlowError } from "@designflow/sdk";
import type { WorkflowPackage } from "@designflow/sdk";

export class WorkflowRegistryError extends DesignFlowError {
  public constructor(
    message: string,
    metadata?: Record<string, unknown>,
  ) {
    super("WORKFLOW_REGISTRY_ERROR", message, metadata);
    this.name = "WorkflowRegistryError";
  }
}

export class WorkflowRegistry {
  private readonly packages = new Map<string, WorkflowPackage>();

  public register(pkg: WorkflowPackage): void {
    const validated = workflowPackageSchema.parse(pkg);

    if (this.packages.has(validated.id)) {
      throw new WorkflowRegistryError(
        `Duplicate workflow ID: "${validated.id}"`,
        { workflowId: validated.id },
      );
    }

    this.packages.set(validated.id, validated as WorkflowPackage);
  }

  public get(id: string): WorkflowPackage | undefined {
    return this.packages.get(id);
  }

  public list(): readonly WorkflowPackage[] {
    return Array.from(this.packages.values());
  }
}
