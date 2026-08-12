// apps/designflow-cli/src/spec-wire-compatibility.test.ts
//
// Specification V2 structured-output compatibility (field run 9a9ed5d1).
//
// The pre-fix provider-facing schema (saved verbatim as a fixture) violated
// the portable strict subset in several ways — nullable OBJECT unions,
// enums containing null, a zero-length array bound, depth 13, 245 total
// properties — and the old preflight never descended into nullable-object
// nodes, so the invalid shared schema burned every fallback candidate at the
// gateway. These tests pin both directions: the pre-fix schema must FAIL the
// upgraded preflight, and the portable wire schema (plus every other agent's
// provider schema) must pass it. The shared-invalid case must consume zero
// provider calls.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openRouterResponseSchemaIssues } from "@designflow/model-provider-openrouter";
import {
  figmaSpecificationResponseSchema,
  implementationResponseSchema,
  visualValidationResponseSchema,
  visualCorrectionResponseSchema,
} from "@designflow/agents";
import { InMemoryModelProfileRegistry, InMemoryModelProviderRegistry, ModelRuntime } from "@designflow/models";
import type { JsonSchemaObject } from "@designflow/sdk";

const PRE_FIX_FIXTURE = fileURLToPath(
  new URL("../../../packages/agents/test/fixtures/spec-v2-wire-schema-pre-fix.json", import.meta.url),
);

describe("Specification V2 wire-schema compatibility (DF field run 9a9ed5d1)", () => {
  test("A(pre-fix): the exact field wire schema violates the portable subset", () => {
    const preFix = JSON.parse(readFileSync(PRE_FIX_FIXTURE, "utf8")) as JsonSchemaObject;
    const issues = openRouterResponseSchemaIssues(preFix);
    expect(issues.length).toBeGreaterThan(0);
    const joined = issues.join("\n");
    expect(joined).toContain("nullable object");
  });

  test("A(post-fix): the portable Specification V2 wire schema passes the preflight", () => {
    expect(openRouterResponseSchemaIssues(figmaSpecificationResponseSchema)).toEqual([]);
  });

  test("every other agent's provider schema still passes the upgraded preflight", () => {
    for (const schema of [implementationResponseSchema, visualValidationResponseSchema, visualCorrectionResponseSchema]) {
      expect(openRouterResponseSchemaIssues(schema)).toEqual([]);
    }
  });

  test("D: a shared invalid schema stops before any provider call — fallback candidates are not burned", async () => {
    const calls: string[] = [];
    const runtime = new ModelRuntime({
      profiles: new InMemoryModelProfileRegistry([
        {
          id: "figma-specification-default",
          providerId: "openrouter",
          model: "openai/gpt-5.6-luna",
          fallbackModels: ["deepseek/deepseek-v4-pro", "openai/gpt-4o-mini"],
        },
      ]),
      providers: new InMemoryModelProviderRegistry([
        {
          id: "openrouter",
          capabilities: () => ({
            jsonMode: true,
            strictJsonSchema: true,
            toolCalling: false,
            maxOutputTokens: 32_000,
            responseSchemaIssues: openRouterResponseSchemaIssues,
          }),
          generate: (async (request: { model: string }) => {
            calls.push(request.model);
            throw new Error("must not be reached");
          }) as never,
        },
      ]),
    });

    const preFix = JSON.parse(readFileSync(PRE_FIX_FIXTURE, "utf8")) as JsonSchemaObject;
    const result = await runtime.generate({
      requestId: "shared-invalid",
      profileId: "figma-specification-default",
      messages: [{ role: "user", content: "hi" }],
      responseSchema: preFix,
    });

    expect(calls).toEqual([]);
    expect(result.type).toBe("failure");
    if (result.type === "failure") {
      expect(result.code).toBe("ERR_MODEL_REQUEST_SCHEMA_INVALID");
      expect(result.message).toContain("portable provider subset");
    }
  });

  test("E: a genuine candidate capability failure still falls back exactly as before", async () => {
    const calls: string[] = [];
    const runtime = new ModelRuntime({
      profiles: new InMemoryModelProfileRegistry([
        {
          id: "figma-specification-default",
          providerId: "openrouter",
          model: "openai/gpt-5.6-luna",
          fallbackModels: ["deepseek/deepseek-v4-pro", "openai/gpt-4o-mini"],
        },
      ]),
      providers: new InMemoryModelProviderRegistry([
        {
          id: "openrouter",
          generate: (async (request: { requestId: string; model: string }) => {
            calls.push(request.model);
            if (request.model === "openai/gpt-5.6-luna") {
              const { DesignFlowError } = await import("@designflow/sdk");
              throw new DesignFlowError("ERR_MODEL_SCHEMA_UNSUPPORTED", "provider rejected schema for this model");
            }
            return {
              requestId: request.requestId,
              providerId: "openrouter",
              model: request.model,
              output: {},
              durationMs: 1,
            };
          }) as never,
        },
      ]),
    });

    const result = await runtime.generate({
      requestId: "candidate-capability",
      profileId: "figma-specification-default",
      messages: [{ role: "user", content: "hi" }],
      responseSchema: figmaSpecificationResponseSchema,
    });

    expect(calls).toEqual(["openai/gpt-5.6-luna", "deepseek/deepseek-v4-pro"]);
    expect(result.type).toBe("success");
  });
});
