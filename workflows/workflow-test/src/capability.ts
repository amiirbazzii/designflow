// workflows/workflow-test/src/capability.ts
import { z } from "zod";
import type { Capability, CapabilityContext } from "@designflow/sdk";
import {
  testArtifactInputSchema,
  testArtifactOutputSchema,
  type TestArtifactInput,
  type TestArtifactOutput,
} from "./types";

export const testArtifactCapability: Capability<TestArtifactInput, TestArtifactOutput> = {
  id: "test-artifact",
  name: "Test Artifact",
  description: "Creates a test artifact with a provided message",
  type: "write_fs",
  inputSchema: testArtifactInputSchema as unknown as z.ZodType<TestArtifactInput>,
  outputSchema: testArtifactOutputSchema as unknown as z.ZodType<TestArtifactOutput>,
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
    return { artifactRef };
  },
};
