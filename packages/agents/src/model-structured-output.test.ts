import { describe, expect, test } from "bun:test";
import type { ModelResult, SpecializedAgentContext } from "@designflow/sdk";
import { EMPTY_TOOL_SERVICE } from "./index";
import { generateValidatedModelOutput } from "./model-structured-output";

const context = (outputs: readonly unknown[]): SpecializedAgentContext => {
  let index = 0;
  return {
    tools: EMPTY_TOOL_SERVICE,
    model: {
      generate: async (): Promise<ModelResult> => ({
        type: "success",
        requestId: `request-${index}`,
        providerId: "test",
        model: "test-model",
        output: outputs[index++] ?? {},
        durationMs: 1,
      }),
    },
    metadata: {},
    signal: new AbortController().signal,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  };
};

describe("specialized structured model output", () => {
  test("allows one bounded repair after Zod validation rejects the initial object", async () => {
    let calls = 0;
    const output = await generateValidatedModelOutput({
      agentId: "fixture-agent",
      context: context([{ invalid: true }, { value: "accepted" }]),
      messages: [{ role: "system", content: "JSON only" }],
      responseSchema: { type: "object" },
      maxOutputTokens: 100,
      validate: (value) => {
        calls += 1;
        if (typeof value !== "object" || value === null || !("value" in value)) throw new Error("value: required");
        return value as { value: string };
      },
    });
    expect(output).toEqual({ value: "accepted" });
    expect(calls).toBe(2);
  });

  test("stops after the initial attempt and one repair", async () => {
    await expect(generateValidatedModelOutput({
      agentId: "fixture-agent",
      context: context([{ invalid: true }, { stillInvalid: true }]),
      messages: [{ role: "system", content: "JSON only" }],
      responseSchema: { type: "object" },
      maxOutputTokens: 100,
      validate: () => { throw new Error("value: required"); },
    })).rejects.toMatchObject({ code: "ERR_AGENT_INVOCATION_OUTPUT_INVALID" });
  });
});
