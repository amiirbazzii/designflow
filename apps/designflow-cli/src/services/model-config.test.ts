// apps/designflow-cli/src/services/model-config.test.ts
import { describe, expect, test } from "bun:test";
import { readModelProfileOverrides } from "./model-config";
import type { Config } from "./config";

function config(models: unknown): Config {
  return { version: 1, firstRunCompleted: true, environment: "local", databasePath: "history/runs.json", settings: { models } } as Config;
}

describe("model profile overrides", () => {
  test("reads model, token, timeout, and providerRouting fields", () => {
    const overrides = readModelProfileOverrides(config({
      profiles: {
        "implementation-default": {
          model: "deepseek/deepseek-v4-flash-0731",
          maxOutputTokens: 8000,
          timeoutMs: 120000,
          providerRouting: { order: ["anthropic"], allowFallbacks: false, dataCollection: "deny" },
        },
      },
    }));
    expect(overrides["implementation-default"]).toEqual({
      model: "deepseek/deepseek-v4-flash-0731",
      maxOutputTokens: 8000,
      timeoutMs: 120000,
      providerRouting: { order: ["anthropic"], allowFallbacks: false, dataCollection: "deny" },
    });
  });

  test("ignores malformed providerRouting rather than guessing", () => {
    const overrides = readModelProfileOverrides(config({
      profiles: {
        "implementation-default": {
          model: "some/model",
          providerRouting: { order: "not-an-array", dataCollection: "sometimes" },
        },
      },
    }));
    expect(overrides["implementation-default"]).toEqual({ model: "some/model" });
  });

  test("absent models settings mean no overrides", () => {
    expect(readModelProfileOverrides(config(undefined))).toEqual({});
  });
});
