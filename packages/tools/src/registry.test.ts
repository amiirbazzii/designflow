// packages/tools/src/registry.test.ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DesignFlowError,
  type Tool,
  type ToolContext,
  type ToolManifest,
} from "@designflow/sdk";

import { z } from "zod";
import { InMemoryToolRegistry } from "./registry";
import { ToolRuntime } from "./runtime";
import { builtInTools, createToolRegistry } from "./index";
import { classifyDesignTaskTool } from "./catalog/classify-design-task";
import { createProjectSummaryTool } from "./catalog/project-summary";

/**
 * The tool catalogue and the two tools that ship with it.
 *
 * The registry tests mirror the agent registry's, because the failure they
 * prevent is the same: an id silently resolving to a different implementation
 * than the one a reviewed allow-list named.
 *
 * The `project-summary` tests are mostly about containment. It is the only
 * thing in this stage that touches a filesystem, so what it *cannot* reach
 * matters more than what it reports.
 */

const MANIFEST: ToolManifest = {
  id: "test-tool",
  name: "Test Tool",
  description: "Does something in tests",
  version: "1.0.0",
  inputSchema: { description: "in", fields: [] },
  outputSchema: { description: "out", fields: [] },
};

function tool(overrides: Partial<ToolManifest> = {}): Tool {
  return {
    manifest: { ...MANIFEST, ...overrides },
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    execute: () => Promise.resolve({}),
  };
}

// ── 6/7/8. Registry ─────────────────────────────────────────────

describe("registering a tool", () => {
  test("validates the manifest at the boundary", () => {
    const registry = new InMemoryToolRegistry();

    expect(() => registry.register(tool({ id: "" }))).toThrow();
    expect(() => registry.register(tool({ version: "" }))).toThrow();
  });

  test("refuses a duplicate id rather than overwriting", () => {
    const registry = new InMemoryToolRegistry([tool()]);

    try {
      registry.register(tool());
      throw new Error("expected a duplicate registration to be refused");
    } catch (error) {
      expect(error).toBeInstanceOf(DesignFlowError);
      expect((error as DesignFlowError).code).toBe("ERR_TOOL_ALREADY_REGISTERED");
    }
  });

  test("a duplicate does not replace the tool already registered", () => {
    // Otherwise `allowedTools: ["x"]` would grant whichever `x` registered
    // last — a reviewed permission quietly meaning something else.
    const registry = new InMemoryToolRegistry([tool({ name: "First" })]);

    expect(() => registry.register(tool({ name: "Second" }))).toThrow();
    expect(registry.require("test-tool").manifest.name).toBe("First");
  });

  test("two different tools coexist", () => {
    const registry = new InMemoryToolRegistry([tool(), tool({ id: "other" })]);

    expect(registry.ids()).toEqual(["test-tool", "other"]);
  });
});

describe("resolving a tool", () => {
  test("finds a registered tool", () => {
    expect(new InMemoryToolRegistry([tool()]).get("test-tool")).toBeDefined();
    expect(new InMemoryToolRegistry([tool()]).has("test-tool")).toBe(true);
  });

  test("returns undefined for an unknown id", () => {
    expect(new InMemoryToolRegistry().get("nobody")).toBeUndefined();
    expect(new InMemoryToolRegistry().has("nobody")).toBe(false);
  });

  test("require names what went wrong and what was available", () => {
    try {
      new InMemoryToolRegistry([tool()]).require("nobody");
      throw new Error("expected an unknown tool to be refused");
    } catch (error) {
      expect((error as DesignFlowError).code).toBe("ERR_TOOL_NOT_FOUND");
      expect((error as DesignFlowError).metadata.available).toEqual(["test-tool"]);
    }
  });

  test("listing returns manifests, not invocable tools", () => {
    const [listed] = new InMemoryToolRegistry([tool()]).list();

    expect(listed).not.toHaveProperty("execute");
    expect(listed?.id).toBe("test-tool");
  });
});

describe("the built-in catalogue", () => {
  const DETERMINISTIC_TOOL_IDS = [
    "classify-design-task",
    "classify-review-target",
    "summarize-artifact-set",
    "accessibility-checklist",
    "classify-research-request",
    "validate-source-metadata",
    "extract-structured-claims",
    "classify-product-request",
    "identify-requirement-gaps",
    "structure-acceptance-criteria",
  ];

  test("ships every agent's tools and nothing that needs a filesystem grant", () => {
    // `project-summary` reads a directory, so it appears only when a host has
    // named one. A tool needing a grant does not get one by default.
    expect(createToolRegistry().ids()).toEqual(DETERMINISTIC_TOOL_IDS);
  });

  test("adds project-summary only when a root is supplied", () => {
    expect(builtInTools({ projectRoot: "/tmp" }).map((t) => t.manifest.id)).toEqual([
      ...DETERMINISTIC_TOOL_IDS,
      "project-summary",
    ]);
  });

  test("a fresh registry per call, so hosts cannot leak tools into each other", () => {
    const first = createToolRegistry();
    first.register(tool({ id: "host-specific" }));

    expect(createToolRegistry().has("host-specific")).toBe(false);
  });
});

// ── The classifier ──────────────────────────────────────────────

describe("classify-design-task", () => {
  const runtime = new ToolRuntime({
    registry: new InMemoryToolRegistry([classifyDesignTaskTool]),
  });

  async function classify(request: string): Promise<Record<string, unknown>> {
    const result = await runtime.invoke({
      call: { id: "c", toolId: "classify-design-task", input: { request } },
      allowedTools: ["classify-design-task"],
    });

    if (result.type !== "success") throw new Error(`failed: ${result.code}`);
    return result.output as Record<string, unknown>;
  }

  test("recognises each kind of design work", async () => {
    expect((await classify("build a login button")).taskType).toBe("new_component");
    expect((await classify("update the card spacing")).taskType).toBe("modify_component");
    expect((await classify("the dashboard screen")).taskType).toBe("page");
  });

  test("recognises a design file handed over with no instruction", async () => {
    // "Build what is in this" is a real request; asking a clarifying question
    // about the file someone just named would be unhelpful.
    expect((await classify("homepage.fig")).taskType).toBe("page");
  });

  test("says unknown when nothing matches", async () => {
    const output = await classify("do the thing");

    expect(output.taskType).toBe("unknown");
    expect(output.confidence).toBe(0);
    expect(output.signals).toEqual([]);
  });

  test("matches on word boundaries, not substrings", async () => {
    // "scanned" must not match "can", "viewport" must not match "view".
    expect((await classify("it scanned nothing")).taskType).toBe("unknown");
  });

  test("is deterministic and reports the words behind the answer", async () => {
    const first = await classify("build a new card component");
    const second = await classify("build a new card component");

    expect(first).toEqual(second);
    // Reported in rule order, which is what makes the answer reproducible.
    expect(first.signals).toEqual(["component", "card", "build", "new"]);
  });

  test("confidence saturates rather than climbing with every match", async () => {
    // A confidence that kept rising would invite reading precision into a
    // keyword count.
    expect(await classify("build a new card component button form modal").then((o) => o.confidence))
      .toBeLessThanOrEqual(1);
  });

  test("an empty request is unknown, not an error", async () => {
    expect((await classify("")).taskType).toBe("unknown");
  });
});

// ── project-summary containment ─────────────────────────────────

describe("project-summary", () => {
  function workspace(): string {
    const root = mkdtempSync(join(tmpdir(), "df-tool-"));

    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        name: "sample-project",
        packageManager: "bun@1.3.14",
        dependencies: { react: "^18.0.0", tailwindcss: "^3.0.0" },
      }),
    );
    writeFileSync(join(root, "index.tsx"), "export const a = 1;");
    writeFileSync(join(root, ".env"), "API_KEY=super-secret-value");
    writeFileSync(join(root, "credentials.json"), "{}");
    mkdirSync(join(root, "node_modules", "left-pad"), { recursive: true });
    writeFileSync(join(root, "node_modules", "left-pad", "index.js"), "");
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "App.tsx"), "");

    return root;
  }

  const context: ToolContext = {
    signal: new AbortController().signal,
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    metadata: {},
  };

  test("reports name, package manager and frameworks", async () => {
    const root = workspace();
    try {
      const summary = await createProjectSummaryTool({ root }).execute({}, context);

      expect(summary).toMatchObject({
        projectName: "sample-project",
        packageManager: "bun",
      });
      expect((summary as { detectedFrameworks: string[] }).detectedFrameworks).toEqual([
        "react",
        "tailwind",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("never reports dotfiles, secrets or node_modules", async () => {
    const root = workspace();
    try {
      const summary = await createProjectSummaryTool({ root }).execute({}, context);
      const files = (summary as { relevantFiles: string[] }).relevantFiles;
      const serialized = JSON.stringify(summary);

      expect(files).toContain("index.tsx");
      expect(files).toContain("src/App.tsx");

      // Even a *name* can be something a person did not mean to hand over —
      // and the contents are never opened at all.
      expect(serialized).not.toContain(".env");
      expect(serialized).not.toContain("credentials");
      expect(serialized).not.toContain("node_modules");
      expect(serialized).not.toContain("super-secret-value");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("refuses a path outside the approved root", async () => {
    const root = workspace();
    try {
      const summarize = createProjectSummaryTool({ root });

      for (const escape of ["..", "../..", "/etc", "../../../../"]) {
        await expect(summarize.execute({ projectPath: escape }, context)).rejects.toThrow(
          /outside the approved project directory|could not be read/,
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a symlink cannot be used to escape the root", async () => {
    const root = workspace();
    const outside = mkdtempSync(join(tmpdir(), "df-outside-"));

    try {
      writeFileSync(join(outside, "leaked.tsx"), "");
      symlinkSync(outside, join(root, "escape-hatch"));

      // Following the link as a path: refused, because realpath resolves it
      // before the containment check.
      await expect(
        createProjectSummaryTool({ root }).execute({ projectPath: "escape-hatch" }, context),
      ).rejects.toThrow(/outside the approved project directory/);

      // Traversed from inside: skipped entirely rather than followed.
      const summary = await createProjectSummaryTool({ root }).execute({}, context);
      expect(JSON.stringify(summary)).not.toContain("leaked.tsx");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("an error never echoes the path that was attempted", async () => {
    const root = workspace();
    try {
      await createProjectSummaryTool({ root }).execute(
        { projectPath: "/etc/ssh/sshd_config" },
        context,
      );
      throw new Error("expected the tool to refuse");
    } catch (error) {
      expect((error as Error).message).not.toContain("/etc/ssh");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a project with no manifest still summarises", async () => {
    const root = mkdtempSync(join(tmpdir(), "df-bare-"));
    try {
      writeFileSync(join(root, "README.md"), "# bare");

      const summary = await createProjectSummaryTool({ root }).execute({}, context);

      expect(summary).toEqual({
        detectedFrameworks: [],
        relevantFiles: ["README.md"],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("stops when its signal fires", async () => {
    const root = workspace();
    const controller = new AbortController();
    controller.abort();

    try {
      const summary = await createProjectSummaryTool({ root }).execute(
        {},
        { ...context, signal: controller.signal },
      );

      expect((summary as { relevantFiles: string[] }).relevantFiles).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("is deterministic across calls", async () => {
    const root = workspace();
    try {
      const summarize = createProjectSummaryTool({ root });

      // readdir order is not guaranteed; an unstable summary would make the
      // agent reading it non-deterministic for no reason.
      expect(await summarize.execute({}, context)).toEqual(
        await summarize.execute({}, context),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
