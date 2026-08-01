// packages/core/src/registry.ts
import {
  capabilityPackageSchema,
  DesignFlowError,
  type Capability,
  type CapabilityPackage,
  type CapabilityManifest,
} from "@designflow/sdk";

export class CapabilityRegistryError extends DesignFlowError {
  public constructor(
    message: string,
    metadata?: Record<string, unknown>,
  ) {
    super("CAPABILITY_REGISTRY_ERROR", message, metadata);
    this.name = "CapabilityRegistryError";
  }
}

export class CapabilityRegistry {
  private readonly packages = new Map<string, CapabilityPackage>();

  public register(capability: Capability<unknown, unknown>): void {
    this.registerPackage({
      manifest: {
        id: capability.id,
        name: capability.name,
        version: "0.0.0",
        description: capability.description,
        type: capability.type,
      },
      capability,
    });
  }

  public registerPackage(pkg: CapabilityPackage): void {
    const validated = capabilityPackageSchema.parse(pkg);

    if (this.packages.has(validated.manifest.id)) {
      throw new CapabilityRegistryError(
        `Duplicate capability ID: "${validated.manifest.id}"`,
        { capabilityId: validated.manifest.id },
      );
    }

    this.packages.set(validated.manifest.id, {
      manifest: validated.manifest,
      capability: validated.capability,
    });
  }

  public get(id: string): Capability<unknown, unknown> | undefined {
    return this.packages.get(id)?.capability;
  }

  public getPackage(id: string): CapabilityPackage | undefined {
    return this.packages.get(id);
  }

  public getManifest(id: string): CapabilityManifest | undefined {
    return this.packages.get(id)?.manifest;
  }

  public has(id: string): boolean {
    return this.packages.has(id);
  }

  public list(): readonly Capability<unknown, unknown>[] {
    return Array.from(this.packages.values()).map((p) => p.capability);
  }

  public listPackages(): readonly CapabilityPackage[] {
    return Array.from(this.packages.values());
  }

  public listManifests(): readonly CapabilityManifest[] {
    return Array.from(this.packages.values()).map((p) => p.manifest);
  }

  public clear(): void {
    this.packages.clear();
  }
}
