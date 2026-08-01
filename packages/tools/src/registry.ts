// packages/tools/src/registry.ts
import {
  toolManifestSchema,
  type Tool,
  type ToolContext,
  type ToolManifest,
} from "@designflow/sdk";

import { DuplicateToolError, ToolNotFoundError } from "./errors";

/**
 * The tool catalogue.
 *
 * Registration and resolution only, exactly like the agent and worker
 * registries. Nothing here executes a tool, checks a permission or knows an
 * agent exists — `ToolRuntime` does all three, and keeping them apart is what
 * lets a host list what is installed without that listing being a way to run
 * anything.
 *
 * This registry is never handed to an agent. An agent that held it could
 * enumerate every installed tool and reach the executable object on each,
 * which would make the allow-list advisory. Agents get `AgentToolService`,
 * which has one verb and re-checks every call.
 */
export class InMemoryToolRegistry {
  private readonly tools = new Map<string, Tool>();

  public constructor(initial: readonly Tool[] = []) {
    for (const tool of initial) this.register(tool);
  }

  /**
   * Adds a tool, validating its manifest at the boundary.
   *
   * A duplicate id is refused rather than overwritten. An agent's
   * `allowedTools` names a tool by id, so silently replacing one would change
   * what a reviewed permission actually grants — the same failure the agent
   * registry refuses for the same reason.
   */
  public register(tool: Tool): void {
    const manifest = Object.freeze(toolManifestSchema.parse(tool.manifest));

    if (this.tools.has(manifest.id)) {
      throw new DuplicateToolError(manifest.id);
    }

    // What gets stored is a frozen snapshot taken at registration — the parsed
    // manifest and the schema *references* — not the tool object itself.
    //
    // This is a security boundary, not tidiness. A tool keeps a reference to
    // its own object, so anything the runtime reads off that object at call
    // time is something the tool can rewrite from inside `execute`:
    //
    //   `outputSchema` → swap it for `z.any()` and every guarantee about
    //                    validated output evaporates, on the very same call
    //   `timeoutMs`    → raise it and the next call runs unbounded
    //   `id`           → change it and the permission check is looking at a
    //                    different name than the one that was granted
    //
    // Capturing here means the enforcing layer only ever consults values that
    // were validated once, before the tool had a chance to run.
    this.tools.set(
      manifest.id,
      Object.freeze({
        manifest,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        execute: (input: unknown, context: ToolContext) =>
          tool.execute(input, context),
      }),
    );
  }

  public get(toolId: string): Tool | undefined {
    return this.tools.get(toolId);
  }

  /** Like `get`, but says what went wrong and what was available. */
  public require(toolId: string): Tool {
    const tool = this.get(toolId);

    if (tool === undefined) {
      throw new ToolNotFoundError(toolId, this.ids());
    }

    return tool;
  }

  /**
   * The installed manifests, in registration order.
   *
   * Manifests rather than tools: listing is for showing what is installed, and
   * handing out the objects with `execute` on them would make the catalogue a
   * way to invoke one.
   */
  public list(): readonly ToolManifest[] {
    return [...this.tools.values()].map((tool) => tool.manifest);
  }

  public ids(): readonly string[] {
    return [...this.tools.keys()];
  }

  public has(toolId: string): boolean {
    return this.tools.has(toolId);
  }
}
