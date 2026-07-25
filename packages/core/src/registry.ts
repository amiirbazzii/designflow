import type { Capability } from "@designflow/sdk";

export class CapabilityRegistry {
  private readonly capabilities = new Map<string, Capability<unknown, unknown>>();

  public register(capability: Capability<unknown, unknown>): void {
    this.capabilities.set(capability.id, capability);
  }

  public get(id: string): Capability<unknown, unknown> | undefined {
    return this.capabilities.get(id);
  }

  public has(id: string): boolean {
    return this.capabilities.has(id);
  }

  public list(): readonly Capability<unknown, unknown>[] {
    return Array.from(this.capabilities.values());
  }

  public clear(): void {
    this.capabilities.clear();
  }
}
