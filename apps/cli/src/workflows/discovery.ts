import type { WorkflowProvider } from "@designflow/sdk";
import { workflowPackages } from "./config";
import { WorkflowRegistry } from "./registry";

export async function discoverWorkflows(): Promise<WorkflowRegistry> {
  const registry = new WorkflowRegistry();
  for (const pkg of workflowPackages) {
    const mod: { provider?: WorkflowProvider } = await import(pkg);
    if (mod.provider) {
      const manifest = mod.provider.getManifest();
      registry.register(manifest);
    }
  }
  return registry;
}
