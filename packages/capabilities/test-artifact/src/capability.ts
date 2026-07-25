import { z } from "zod";
import type { Capability, CapabilityContext } from "@designflow/sdk";

const testArtifactInputSchema = z.object({
  message: z.string(),
});

const testArtifactOutputSchema = z.object({
  artifactRef: z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    metadata: z.record(z.string(), z.unknown()),
  }),
});

export type TestArtifactInput = z.infer<typeof testArtifactInputSchema>;
export type TestArtifactOutput = z.infer<typeof testArtifactOutputSchema>;

export const testArtifactCapability: Capability<TestArtifactInput, TestArtifactOutput> = {
  id: "test-artifact",
  name: "Test Artifact",
  description: "Creates a test artifact with a provided message",
  type: "write_fs",
  inputSchema: testArtifactInputSchema,
  outputSchema: testArtifactOutputSchema,
  async execute(context: CapabilityContext, input: TestArtifactInput): Promise<TestArtifactOutput> {
    const parsed = testArtifactInputSchema.parse(input);
    const payload = {
      message: parsed.message,
      createdAt: new Date().toISOString(),
    };
    const artifactRef = await context.artifactStore.save(
      payload,
      { type: "test-artifact" },
    );
    return { artifactRef: { ...artifactRef, metadata: {} } };
  },
};
