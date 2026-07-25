import { z } from "zod";

export const testArtifactInputSchema = z.object({
  message: z.string(),
});

export const testArtifactOutputSchema = z.object({
  artifactRef: z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    metadata: z.record(z.string(), z.unknown()).default({}),
  }),
});

export type TestArtifactInput = z.infer<typeof testArtifactInputSchema>;
export type TestArtifactOutput = z.infer<typeof testArtifactOutputSchema>;
