// packages/sdk/src/capability-manifest.ts
import { z } from "zod";
import { capabilityTypeSchema, semanticVersionSchema } from "./schemas";
import type { CapabilityPackage, Capability } from "./capability";

export const capabilityManifestSchema = z.object({
  id: z.string().min(1, "Capability ID is required"),
  name: z.string().min(1, "Capability name is required"),
  version: semanticVersionSchema,
  description: z.string().optional(),
  type: capabilityTypeSchema,
  metadata: z
    .object({
      author: z.string().optional(),
      tags: z.array(z.string()).default([]),
    })
    .optional(),
});

export type CapabilityManifest = z.infer<typeof capabilityManifestSchema>;

export const capabilityPackageSchema = z
  .object({
    manifest: capabilityManifestSchema,
    capability: z.custom<Capability<unknown, unknown>>(),
  })
  .refine(
    (data) => data.capability.id === data.manifest.id,
    {
      message: "capability.id must match manifest.id",
      path: ["capability", "id"],
    },
  )
  .refine(
    (data) => data.capability.type === data.manifest.type,
    {
      message: "capability.type must match manifest.type",
      path: ["capability", "type"],
    },
  );

export function parseCapabilityPackage(input: unknown): CapabilityPackage {
  const result = capabilityPackageSchema.parse(input);
  return {
    manifest: result.manifest,
    capability: result.capability,
  };
}
