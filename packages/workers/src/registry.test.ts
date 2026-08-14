// packages/workers/src/registry.test.ts
import { describe, expect, test } from "bun:test";
import {
  DesignFlowError,
  primaryWorkflowOf,
  workerManifestSchema,
  type WorkerManifest,
} from "@designflow/sdk";
import {
  DuplicateWorkerError,
  InMemoryWorkerRegistry,
  WorkerNotFoundError,
} from "./registry";
import {
  BUILT_IN_WORKERS,
  createWorkerRegistry,
  designEngineer,
  productManager,
  qaReviewer,
  researchAnalyst,
} from "./index";

const worker = (overrides?: Partial<WorkerManifest>): WorkerManifest =>
  workerManifestSchema.parse({
    id: "test-worker",
    name: "Test Worker",
    description: "Does test things",
    category: "testing",
    workflows: ["test-workflow"],
    ...overrides,
  });

// ── 1. Manifest validation ──────────────────────────────────────

describe("worker manifest validation", () => {
  test("accepts a complete manifest", () => {
    const parsed = workerManifestSchema.parse({
      id: "design-engineer",
      name: "Design Engineer",
      description: "Transforms designs into production-ready applications",
      category: "development",
      workflows: ["design-to-code"],
    });

    expect(parsed.id).toBe("design-engineer");
    expect(parsed.inputs).toEqual([]);
  });

  test("requires every identity field", () => {
    for (const field of ["id", "name", "description", "category"]) {
      const base: Record<string, unknown> = {
        id: "a",
        name: "A",
        description: "d",
        category: "c",
        workflows: ["w"],
      };
      delete base[field];

      expect(workerManifestSchema.safeParse(base).success).toBe(false);
    }
  });

  test("refuses a worker that names no workflow", () => {
    // A catalogue entry for work that cannot happen is worse than no entry.
    expect(
      workerManifestSchema.safeParse({
        id: "a",
        name: "A",
        description: "d",
        category: "c",
        workflows: [],
      }).success,
    ).toBe(false);
  });

  test("validates input field descriptors", () => {
    const parsed = workerManifestSchema.parse({
      id: "a",
      name: "A",
      description: "d",
      category: "c",
      workflows: ["w"],
      inputs: [
        { key: "file", label: "File", placeholder: "a.fig" },
        {
          key: "framework",
          label: "Framework",
          placeholder: "react",
          choices: ["react", "vue"],
        },
        { key: "frames", label: "Frames", placeholder: "a, b", list: true },
      ],
    });

    expect(parsed.inputs).toHaveLength(3);
    expect(parsed.inputs[1]?.choices).toEqual(["react", "vue"]);
    expect(parsed.inputs[2]?.list).toBe(true);

    expect(
      workerManifestSchema.safeParse({
        id: "a",
        name: "A",
        description: "d",
        category: "c",
        workflows: ["w"],
        inputs: [{ key: "", label: "L", placeholder: "p" }],
      }).success,
    ).toBe(false);
  });

  test("resolves the entry-point workflow", () => {
    expect(primaryWorkflowOf(worker({ workflows: ["first", "second"] }))).toBe(
      "first",
    );
  });

  test("the shipped Design Engineer manifest is valid", () => {
    expect(() => workerManifestSchema.parse(designEngineer)).not.toThrow();
    expect(designEngineer.workflows).toEqual([
      "design-to-code-figma-specification",
      "design-to-code-v2",
      "design-to-code-implementation",
      "design-to-code",
    ]);
    expect(designEngineer.inputs).toHaveLength(3);
  });
});

// ── 2. Listing ──────────────────────────────────────────────────

describe("listing workers", () => {
  test("lists the built-in catalogue", () => {
    const registry = createWorkerRegistry();

    expect(registry.listWorkers().map((w) => w.id)).toEqual([
      "design-engineer",
      "qa-reviewer",
      "research-analyst",
      "product-manager",
    ]);
    expect(BUILT_IN_WORKERS).toHaveLength(4);
  });

  test("preserves registration order", () => {
    const registry = new InMemoryWorkerRegistry([
      worker({ id: "c" }),
      worker({ id: "a" }),
      worker({ id: "b" }),
    ]);

    expect(registry.listWorkers().map((w) => w.id)).toEqual(["c", "a", "b"]);
  });

  test("starts empty when given nothing", () => {
    expect(new InMemoryWorkerRegistry().listWorkers()).toEqual([]);
  });

  test("groups by category for a catalogue with headings", () => {
    const registry = new InMemoryWorkerRegistry([
      worker({ id: "a", category: "development" }),
      worker({ id: "b", category: "design" }),
      worker({ id: "c", category: "development" }),
    ]);

    const grouped = registry.listByCategory();

    expect(grouped.get("development")?.map((w) => w.id)).toEqual(["a", "c"]);
    expect(grouped.get("design")?.map((w) => w.id)).toEqual(["b"]);
  });

  test("hands each host its own catalogue", () => {
    const first = createWorkerRegistry();
    first.registerWorker(worker({ id: "host-specific" }));

    // A leaked registration is a confusing failure two files away.
    expect(createWorkerRegistry().getWorker("host-specific")).toBeUndefined();
  });
});

// ── 3. Resolution ───────────────────────────────────────────────

describe("resolving a worker", () => {
  test("finds a worker by id", () => {
    const registry = createWorkerRegistry();

    expect(registry.getWorker("design-engineer")?.name).toBe("Design Engineer");
  });

  test("returns undefined for an unknown id", () => {
    expect(createWorkerRegistry().getWorker("nobody")).toBeUndefined();
  });

  test("requireWorker names what was available", () => {
    const registry = createWorkerRegistry();

    try {
      registry.requireWorker("nobody");
      throw new Error("expected a rejection");
    } catch (error) {
      if (!(error instanceof DesignFlowError)) throw error;

      expect(error.code).toBe("ERR_WORKER_NOT_FOUND");
      expect(error.metadata.available).toEqual([
        "design-engineer",
        "qa-reviewer",
        "research-analyst",
        "product-manager",
      ]);
      expect(error).toBeInstanceOf(WorkerNotFoundError);
    }
  });

  test("resolves a worker to its workflow", () => {
    const registry = createWorkerRegistry();
    const found = registry.requireWorker("design-engineer");

    expect(primaryWorkflowOf(found)).toBe("design-to-code-figma-specification");
  });

  test("finds the worker that owns a workflow", () => {
    const registry = createWorkerRegistry();

    expect(registry.findByWorkflow("design-to-code-figma-specification")?.id).toBe(
      "design-engineer",
    );
    expect(registry.findByWorkflow("design-to-code")?.id).toBe("design-engineer");
    expect(registry.findByWorkflow("unowned-workflow")).toBeUndefined();
  });
});

// ── Registration ────────────────────────────────────────────────

describe("registering a worker", () => {
  test("adds a worker to the catalogue", () => {
    const registry = createWorkerRegistry();

    registry.registerWorker(worker({ id: "extra" }));

    expect(registry.getWorker("extra")?.name).toBe("Test Worker");
    expect(registry.listWorkers()).toHaveLength(5);
  });

  test("validates at the boundary", () => {
    const registry = new InMemoryWorkerRegistry();

    expect(() =>
      registry.registerWorker({
        id: "",
        name: "A",
        description: "d",
        category: "c",
        workflows: ["w"],
        inputs: [],
      }),
    ).toThrow();
  });

  test("refuses a duplicate id rather than overwriting", () => {
    const registry = createWorkerRegistry();

    try {
      registry.registerWorker(worker({ id: "design-engineer" }));
      throw new Error("expected a rejection");
    } catch (error) {
      if (!(error instanceof DesignFlowError)) throw error;

      // Two workers on one name means `run <id>` silently does something other
      // than what the catalogue showed.
      expect(error.code).toBe("ERR_WORKER_ALREADY_REGISTERED");
      expect(error).toBeInstanceOf(DuplicateWorkerError);
    }

    expect(registry.getWorker("design-engineer")?.name).toBe("Design Engineer");
  });
});

// ── Architecture ────────────────────────────────────────────────

describe("architecture", () => {
  test("a worker carries no behaviour, only metadata", () => {
    for (const value of Object.values(designEngineer)) {
      expect(typeof value).not.toBe("function");
    }
  });

  test("the package imports nothing but the SDK", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");

    const sources = (dir: string): string[] => {
      const found: string[] = [];

      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);

        if (statSync(path).isDirectory()) {
          found.push(...sources(path));
          continue;
        }

        if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
          found.push(path);
        }
      }

      return found;
    };

    for (const path of sources(import.meta.dir)) {
      const contents = readFileSync(path, "utf8");

      // Workers are metadata and composition. Reaching the engine would make
      // them a runtime layer, which is what this stage is not.
      for (const forbidden of [
        "@designflow/core",
        "@designflow/product",
        "@designflow/storage",
      ]) {
        expect(contents).not.toContain(forbidden);
      }
    }
  });
});

// ── Stage 41: four-worker catalogue ─────────────────────────────

describe("stage 41 worker catalogue", () => {
  test("four workers ship, all validate, ids are unique", () => {
    expect(BUILT_IN_WORKERS).toHaveLength(4);

    for (const manifest of BUILT_IN_WORKERS) {
      expect(() => workerManifestSchema.parse(manifest)).not.toThrow();
    }

    const ids = BUILT_IN_WORKERS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every new worker names exactly one workflow and an agent", () => {
    for (const manifest of [qaReviewer, researchAnalyst, productManager]) {
      expect(manifest.workflows).toHaveLength(1);
      expect(manifest.agentId).toBeDefined();
    }
  });

  test("qa-reviewer, research-analyst and product-manager resolve to distinct workflows", () => {
    expect(qaReviewer.workflows).toEqual(["qa-review"]);
    expect(researchAnalyst.workflows).toEqual(["research-analysis"]);
    expect(productManager.workflows).toEqual(["product-brief"]);
  });

  test("every worker declares required evaluation criteria", () => {
    for (const manifest of BUILT_IN_WORKERS) {
      expect(manifest.evaluationCriteria.length).toBeGreaterThan(0);
      expect(manifest.evaluationCriteria.some((c) => c.required)).toBe(true);
    }
  });

  test("no worker manifest names a global/shared model — model choice lives on the agent", () => {
    for (const manifest of BUILT_IN_WORKERS) {
      expect((manifest as Record<string, unknown>)["model"]).toBeUndefined();
      expect((manifest as Record<string, unknown>)["modelProfileId"]).toBeUndefined();
    }
  });

  test("design-engineer exposes its product input form and not the compatibility scaffold", () => {
    expect(designEngineer.workflows).toEqual([
      "design-to-code-figma-specification",
      "design-to-code-v2",
      "design-to-code-implementation",
      "design-to-code",
    ]);
    expect(designEngineer.inputs.map((input) => input.key)).toEqual([
      "request",
      "designFile",
      "frames",
    ]);
  });
});
