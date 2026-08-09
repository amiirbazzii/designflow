// apps/designflow-cli/src/services/figma-mcp-config.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { configSchema } from "./config";
import {
  readExperimentalFigmaMcpEnabled,
  readFigmaMcpConfig,
  resolveFigmaMcpConfig,
  STANDARD_FIGMA_DESKTOP_MCP_URL,
} from "./figma-mcp-config";

function configWithSettings(settings: Record<string, unknown>) {
  return configSchema.parse({ settings });
}

const ENV_KEY = "DESIGNFLOW_TEST_FIGMA_TOKEN";

afterEach(() => {
  delete process.env[ENV_KEY];
});

describe("the experimental flag", () => {
  test("is off when nothing is configured", () => {
    expect(readExperimentalFigmaMcpEnabled(configWithSettings({}))).toBe(false);
  });

  test("is off unless explicitly set to true", () => {
    expect(
      readExperimentalFigmaMcpEnabled(configWithSettings({ experimental: { designEngineerFigmaMcp: "yes" } })),
    ).toBe(false);
  });

  test("is on only when explicitly set to true", () => {
    expect(
      readExperimentalFigmaMcpEnabled(configWithSettings({ experimental: { designEngineerFigmaMcp: true } })),
    ).toBe(true);
  });
});

describe("reading the Figma MCP server config", () => {
  test("returns undefined when nothing is configured", () => {
    expect(readFigmaMcpConfig(configWithSettings({}))).toBeUndefined();
  });

  test("returns undefined when no command is named", () => {
    expect(readFigmaMcpConfig(configWithSettings({ figmaMcp: { args: ["x"] } }))).toBeUndefined();
  });

  test("rejects an unknown transport instead of silently treating it as stdio", () => {
    expect(readFigmaMcpConfig(configWithSettings({ figmaMcp: { transport: "websocket", command: "npx" } }))).toBeUndefined();
  });

  test("reads command, args and timeouts", () => {
    const result = readFigmaMcpConfig(
      configWithSettings({
        figmaMcp: {
          command: "npx",
          args: ["-y", "some-server"],
          connectTimeoutMs: 5000,
          requestTimeoutMs: 20000,
          maxResponseBytes: 1000000,
        },
      }),
    );

    expect(result?.transport).toBe("stdio");
    if (result?.transport !== "stdio") throw new Error("expected stdio configuration");
    expect(result?.command).toBe("npx");
    expect(result?.args).toEqual(["-y", "some-server"]);
    expect(result?.connectTimeoutMs).toBe(5000);
    expect(result?.requestTimeoutMs).toBe(20000);
    expect(result?.maxResponseBytes).toBe(1000000);
  });

  test("captureScreenshots defaults to true", () => {
    const result = readFigmaMcpConfig(configWithSettings({ figmaMcp: { command: "npx" } }));
    expect(result?.transport).toBe("stdio");
    expect(result?.captureScreenshots).toBe(true);
  });

  test("captureScreenshots can be explicitly disabled", () => {
    const result = readFigmaMcpConfig(
      configWithSettings({ figmaMcp: { command: "npx", captureScreenshots: false } }),
    );
    expect(result?.transport).toBe("stdio");
    expect(result?.captureScreenshots).toBe(false);
  });

  test("reads the official localhost HTTP configuration", () => {
    const result = readFigmaMcpConfig(
      configWithSettings({
        figmaMcp: {
          transport: "http",
          url: "http://127.0.0.1:3845/mcp",
          connectTimeoutMs: 10000,
          requestTimeoutMs: 30000,
          maxResponseBytes: 5000000,
          captureScreenshots: true,
          envPassthrough: ["FIGMA_ACCESS_TOKEN"],
        },
      }),
    );

    expect(result).toEqual({
      transport: "http",
      url: "http://127.0.0.1:3845/mcp",
      connectTimeoutMs: 10000,
      requestTimeoutMs: 30000,
      maxResponseBytes: 5000000,
      captureScreenshots: true,
    });
  });
});

describe("credential handling", () => {
  test("only forwards an env var actually named in envPassthrough", () => {
    process.env[ENV_KEY] = "sk-test-secret-value";
    process.env["DESIGNFLOW_TEST_UNRELATED"] = "should-not-appear";

    const result = readFigmaMcpConfig(
      configWithSettings({ figmaMcp: { command: "npx", envPassthrough: [ENV_KEY] } }),
    );

    expect(result?.transport).toBe("stdio");
    if (result?.transport !== "stdio") throw new Error("expected stdio configuration");
    expect(result?.env).toEqual({ [ENV_KEY]: "sk-test-secret-value" });
    expect(Object.keys(result?.env ?? {})).not.toContain("DESIGNFLOW_TEST_UNRELATED");

    delete process.env["DESIGNFLOW_TEST_UNRELATED"];
  });

  test("a credential value never appears anywhere in config.json's own settings", () => {
    process.env[ENV_KEY] = "sk-test-secret-value";

    const config = configWithSettings({ figmaMcp: { command: "npx", envPassthrough: [ENV_KEY] } });

    // The config object itself — what would actually be written to
    // config.json — names the env var, never the credential's value.
    expect(JSON.stringify(config.settings)).not.toContain("sk-test-secret-value");
  });

  test("an unset envPassthrough var is simply absent, not an empty string", () => {
    const result = readFigmaMcpConfig(
      configWithSettings({ figmaMcp: { command: "npx", envPassthrough: ["DESIGNFLOW_TEST_NEVER_SET"] } }),
    );
    expect(result?.transport).toBe("stdio");
    if (result?.transport !== "stdio") throw new Error("expected stdio configuration");
    expect(result?.env).toEqual({});
  });
});

describe("automatic Figma Desktop configuration", () => {
  test("uses only the documented standard endpoint for bare interactive detection", () => {
    const resolved = resolveFigmaMcpConfig(configWithSettings({}), {
      autoDetectDesktop: true,
    });

    expect(resolved.source).toBe("automatic");
    expect(resolved.config).toMatchObject({
      transport: "http",
      url: STANDARD_FIGMA_DESKTOP_MCP_URL,
    });
  });

  test("prefers explicit configuration over automatic detection", () => {
    const resolved = resolveFigmaMcpConfig(
      configWithSettings({
        figmaMcp: { transport: "http", url: "http://localhost:4100/mcp" },
      }),
      { autoDetectDesktop: true },
    );

    expect(resolved.source).toBe("explicit");
    expect(resolved.config).toMatchObject({
      transport: "http",
      url: "http://localhost:4100/mcp",
    });
  });

  test("does not replace an invalid explicit block with the standard endpoint", () => {
    const resolved = resolveFigmaMcpConfig(
      configWithSettings({ figmaMcp: { transport: "websocket" } }),
      { autoDetectDesktop: true },
    );

    expect(resolved).toEqual({ source: "invalid" });
  });
});
