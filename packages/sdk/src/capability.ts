// packages/sdk/src/capability.ts
import type { z } from "zod";
import type { CapabilityType } from "./schemas";
import type { CapabilityContext } from "./context";
import type { CapabilityManifest } from "./capability-manifest";

export type { CapabilityType } from "./schemas";
export { capabilityTypeSchema } from "./schemas";

export interface Capability<TInput, TOutput> {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly type: CapabilityType;
  readonly inputSchema: z.ZodType<TInput>;
  readonly outputSchema: z.ZodType<TOutput>;
  /**
   * The capability implementation's own version, distinct from the workflow
   * package version. Folds into a node's reuse fingerprint alongside the
   * workflow version, so a capability whose logic changed without a workflow
   * version bump still invalidates artifacts it previously produced. Absent
   * is treated as `"1"` — every capability shipped before this field existed.
   */
  readonly version?: string;
  execute(context: CapabilityContext, input: TInput): Promise<TOutput>;
}

export interface CapabilityPackage {
  manifest: CapabilityManifest;
  capability: Capability<unknown, unknown>;
}

export interface CapabilityProvider {
  getCapability(): CapabilityPackage;
}