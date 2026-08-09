import { describe, expect, test } from "bun:test";
import type { McpClient } from "@designflow/sdk";
import { probeFigmaConnection } from "./figma-connection";

function clientThat(connect: () => Promise<void>): McpClient {
  return {
    connect,
    async listTools() {
      return [];
    },
    async callTool() {
      return {
        type: "failure",
        toolName: "test",
        code: "ERR_MCP_TEST",
        message: "test",
        retryable: false,
        durationMs: 0,
      };
    },
  };
}

describe("automatic Figma connection probe", () => {
  test("reports connected after the existing client completes its handshake", async () => {
    let attempts = 0;
    const status = await probeFigmaConnection(
      clientThat(async () => {
        attempts += 1;
      }),
    );

    expect(status).toBe("connected");
    expect(attempts).toBe(1);
  });

  test("bounds a rejected or unsupported handshake to an unavailable state", async () => {
    const status = await probeFigmaConnection(
      clientThat(async () => {
        throw new Error("unsupported protocol details must not reach the shell");
      }),
    );

    expect(status).toBe("unavailable");
  });

  test("does not perform discovery when no client was configured", async () => {
    expect(await probeFigmaConnection(undefined)).toBe("unavailable");
  });
});
