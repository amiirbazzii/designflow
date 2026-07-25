import { z } from "zod";

const SEMVER_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function isValidSemver(version: string): boolean {
  return SEMVER_REGEX.test(version);
}

function parseSemver(version: string): [number, number, number] {
  const parts = version.split(".").map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function semverGte(a: string, b: string): boolean {
  const [a1, a2, a3] = parseSemver(a);
  const [b1, b2, b3] = parseSemver(b);
  if (a1 !== b1) return a1 > b1;
  if (a2 !== b2) return a2 > b2;
  return a3 >= b3;
}

export const semanticVersionSchema = z
  .string()
  .min(1, "Version is required")
  .refine(isValidSemver, {
    message: "Invalid semantic version. Expected format: X.Y.Z (e.g., 1.0.0, 0.1.0)",
  });

export type SemanticVersion = z.infer<typeof semanticVersionSchema>;

export const workflowManifestSchema = z
  .object({
    id: z.string().min(1, "Workflow ID is required"),
    name: z.string().min(1, "Workflow name is required"),
    version: semanticVersionSchema,
    description: z.string().optional(),
    capabilities: z.array(z.string()).default([]),
    compatibility: z
      .object({
        minEngineVersion: semanticVersionSchema.optional(),
        maxEngineVersion: semanticVersionSchema.optional(),
      })
      .optional(),
    metadata: z
      .object({
        author: z.string().optional(),
        tags: z.array(z.string()).default([]),
      })
      .optional(),
  })
  .refine(
    (data) => {
      if (!data.compatibility) return true;
      const { minEngineVersion, maxEngineVersion } = data.compatibility;
      if (!minEngineVersion || !maxEngineVersion) return true;
      return semverGte(maxEngineVersion, minEngineVersion);
    },
    {
      message: "maxEngineVersion must be >= minEngineVersion",
      path: ["compatibility"],
    },
  );

export type WorkflowManifest = z.infer<typeof workflowManifestSchema>;
