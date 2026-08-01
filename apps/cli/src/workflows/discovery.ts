// apps/cli/src/workflows/discovery.ts
import { DesignFlowError, type WorkflowProvider } from "@designflow/sdk";
import { workflowPackages } from "./config";
import { WorkflowRegistry } from "./registry";

export class WorkflowDiscoveryError extends DesignFlowError {
  public constructor(
    message: string,
    metadata?: Record<string, unknown>,
  ) {
    super("WORKFLOW_DISCOVERY_ERROR", message, metadata);
    this.name = "WorkflowDiscoveryError";
  }
}

export async function discoverWorkflows(): Promise<WorkflowRegistry> {
  const registry = new WorkflowRegistry();
  for (const pkg of workflowPackages) {
    let mod: { provider?: WorkflowProvider };
    try {
      mod = await import(pkg);
    } catch (cause) {
      throw new WorkflowDiscoveryError(
        "Failed loading workflow provider",
        { package: pkg, cause: String(cause) },
      );
    }
    if (mod.provider) {
      const manifest = mod.provider.getManifest();
      registry.register(manifest);
    }
  }
  return registry;
}
