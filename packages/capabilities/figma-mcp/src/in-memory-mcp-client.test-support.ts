// packages/capabilities/figma-mcp/src/test-support/in-memory-mcp-client.ts
import type { McpClient, McpToolCallRequest, McpToolCallResult, McpToolDescriptor } from "@designflow/sdk";

/**
 * An in-process `McpClient` double — no subprocess, no stdio.
 *
 * Used by this package's unit tests that exercise *logic built on top of*
 * `McpClient` (discovery, tool wrappers, snapshot building), where spawning
 * a real process would only add latency without testing anything the
 * `@designflow/mcp` package's own protocol-level tests don't already cover.
 */
export class InMemoryMcpClient implements McpClient {
  public readonly serverIdentity?: string;
  private readonly tools: readonly McpToolDescriptor[];
  private readonly results: Readonly<Record<string, unknown>>;
  private readonly errorTools: ReadonlySet<string>;

  public readonly calls: McpToolCallRequest[] = [];

  public constructor(options: {
    readonly tools?: readonly McpToolDescriptor[];
    readonly results?: Readonly<Record<string, unknown>>;
    readonly errorTools?: readonly string[];
    readonly serverIdentity?: string;
  }) {
    this.tools = options.tools ?? [];
    this.results = options.results ?? {};
    this.errorTools = new Set(options.errorTools ?? []);
    if (options.serverIdentity !== undefined) this.serverIdentity = options.serverIdentity;
  }

  public async listTools(): Promise<readonly McpToolDescriptor[]> {
    return this.tools;
  }

  public async callTool(request: McpToolCallRequest): Promise<McpToolCallResult> {
    this.calls.push(request);

    if (!this.tools.some((tool) => tool.name === request.toolName)) {
      return {
        type: "failure",
        toolName: request.toolName,
        code: "ERR_MCP_TOOL_NOT_FOUND",
        message: "unknown tool",
        retryable: false,
        durationMs: 0,
      };
    }

    if (this.errorTools.has(request.toolName)) {
      return {
        type: "failure",
        toolName: request.toolName,
        code: "ERR_MCP_TOOL_FAILED",
        message: "the tool reported a failure",
        retryable: false,
        durationMs: 0,
      };
    }

    return {
      type: "success",
      toolName: request.toolName,
      content: this.results[request.toolName] ?? null,
      durationMs: 0,
    };
  }
}
