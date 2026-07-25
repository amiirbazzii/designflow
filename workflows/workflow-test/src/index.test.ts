import { describe, expect, test } from "bun:test";
import type { CapabilityContext, Logger, ArtifactStore } from "@designflow/sdk";
import { workflowDefinitionSchema } from "@designflow/sdk";
import { testArtifactCapability } from "./capability";
import { testWorkflow } from "./workflow";
import type { TestArtifactInput, TestArtifactOutput } from "./types";

describe("@designflow/workflow-test", () => {
  test("capability has correct shape", () => {
    expect(testArtifactCapability.id).toBe("test-artifact");
    expect(testArtifactCapability.name).toBe("Test Artifact");
    expect(testArtifactCapability.type).toBe("write_fs");
    expect(testArtifactCapability.inputSchema).toBeDefined();
    expect(testArtifactCapability.outputSchema).toBeDefined();
  });

  test("capability input schema validates correctly", () => {
    const valid = testArtifactCapability.inputSchema.safeParse({ message: "hello" });
    expect(valid.success).toBe(true);

    const invalid = testArtifactCapability.inputSchema.safeParse({});
    expect(invalid.success).toBe(false);
  });

  test("capability execute creates artifact through store", async () => {
    const logger: Logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    const abortController = new AbortController();

    let savedData: unknown = undefined;
    let savedMetadata: Record<string, unknown> | undefined = undefined;

    const store: ArtifactStore = {
      async save(data, metadata) {
        savedData = data;
        savedMetadata = metadata;
        return { id: crypto.randomUUID(), type: "test-artifact", metadata: {} };
      },
      async get() {
        return null;
      },
      async exists() {
        return false;
      },
    };

    const context: CapabilityContext = {
      executionId: crypto.randomUUID(),
      workflowId: "test-workflow",
      logger,
      artifactRefs: [],
      artifactStore: store,
      config: {},
      signal: abortController.signal,
    };

    const input: TestArtifactInput = { message: "hello from test" };
    const output: TestArtifactOutput = await testArtifactCapability.execute(context, input);

    expect(output.artifactRef).toBeDefined();
    expect(output.artifactRef.id).toBeTruthy();
    expect(output.artifactRef.type).toBe("test-artifact");
    expect(savedData).toBeDefined();
    expect((savedData as Record<string, unknown>).message).toBe("hello from test");
    expect((savedData as Record<string, unknown>).createdAt).toBeTruthy();
    expect(savedMetadata?.type).toBe("test-artifact");
  });

  test("workflow definition passes schema validation", () => {
    const result = workflowDefinitionSchema.safeParse(testWorkflow);
    expect(result.success).toBe(true);
  });
});
