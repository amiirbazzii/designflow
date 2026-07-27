// apps/cli/src/capabilities/loader.ts
import { DesignFlowError } from "@designflow/sdk";
import type { CapabilityProvider } from "@designflow/sdk";
import { CapabilityRegistry } from "@designflow/core";
import { capabilityPackages } from "./config";

export class CapabilityLoaderError extends DesignFlowError {
  public constructor(
    message: string,
    metadata?: Record<string, unknown>,
  ) {
    super("CAPABILITY_LOADER_ERROR", message, metadata);
    this.name = "CapabilityLoaderError";
  }
}

export async function createCapabilityRegistry(): Promise<CapabilityRegistry> {
  const registry = new CapabilityRegistry();

  for (const pkg of capabilityPackages) {
    let mod: { provider?: CapabilityProvider };
    try {
      mod = await import(pkg);
    } catch (cause) {
      throw new CapabilityLoaderError(
        "Failed loading capability provider",
        { package: pkg, cause: String(cause) },
      );
    }

    if (mod.provider) {
      const capabilityPackage = mod.provider.getCapability();
      registry.registerPackage(capabilityPackage);
    }
  }

  return registry;
}
