import type { z } from "zod";
import type { CapabilityType } from "./schemas";
import type { CapabilityContext } from "./context";

export type { CapabilityType } from "./schemas";
export { capabilityTypeSchema } from "./schemas";

export interface Capability<TInput, TOutput> {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly type: CapabilityType;
  readonly inputSchema: z.ZodType<TInput>;
  readonly outputSchema: z.ZodType<TOutput>;
  execute(context: CapabilityContext, input: TInput): Promise<TOutput>;
}