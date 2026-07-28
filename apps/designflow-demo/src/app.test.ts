// apps/designflow-demo/src/app.test.ts
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { runDemo } from "./app";
import { createDemoHost } from "./host";
import type { DemoHost } from "./host";
import { ScriptedIO } from "./io";
import { DEMO_WORKFLOWS } from "./catalog";
import { renderProgress } from "./screens";

/**
 * Behaviour tests: they drive the journey the way a person would and assert on
 * what the person would see. No screen is inspected in isolation unless the
 * rendering itself is the thing under test.
 */

// ── Helpers ─────────────────────────────────────────────────────

/** Answers for the input form: design file, framework, frames. */
const DESIGN_ANSWERS = [
  "homepage.fig",
  "react",
  "brand/Header, brand/Footer, layout/Dashboard",
];

const approvingRun = (): { host: DemoHost; io: ScriptedIO } => ({
  host: createDemoHost(),
  io: new ScriptedIO(["1", ...DESIGN_ANSWERS, "approve"]),
});

// ── 1. User can select a workflow ───────────────────────────────

describe("workflow selection", () => {
  test("offers the catalogue on the landing screen", async () => {
    const { host, io } = approvingRun();

    await runDemo(host, io);

    expect(io.transcript).toContain("DesignFlow");
    expect(io.transcript).toContain("Turn ideas into production workflows.");
    expect(io.transcript).toContain("1. Design → Code");
    expect(io.transcript).toContain(
      "Turn a design file into reviewed, production-ready components",
    );
  });

  test("accepts a selection by number", async () => {
    const { host, io } = approvingRun();

    const result = await runDemo(host, io);

    expect(result.workflowId).toBe("design-to-code");
    expect(io.questions[0]).toBe("Start which workflow?");
  });

  test("accepts a selection by name", async () => {
    const host = createDemoHost();
    const io = new ScriptedIO(["Design → Code", ...DESIGN_ANSWERS, "approve"]);

    const result = await runDemo(host, io);

    expect(result.workflowId).toBe("design-to-code");
  });

  test("rejects an unknown selection", async () => {
    const host = createDemoHost();
    const io = new ScriptedIO(["nope"]);

    await expect(runDemo(host, io)).rejects.toThrow("Unknown workflow");
  });

  test("can be handed a workflow directly, skipping the prompt", async () => {
    const host = createDemoHost();
    const io = new ScriptedIO([...DESIGN_ANSWERS, "approve"]);

    const result = await runDemo(host, io, { workflowId: "design-to-code" });

    expect(result.workflowId).toBe("design-to-code");
    expect(io.questions[0]).toContain("Design file");
  });
});

// ── 2. Workflow can be started ──────────────────────────────────

describe("starting a workflow", () => {
  test("asks for every field the workflow declares", async () => {
    const { host, io } = approvingRun();

    await runDemo(host, io);

    expect(io.questions).toEqual([
      "Start which workflow?",
      "Design file (homepage.fig)",
      "Framework (react)",
      "Frames (comma separated) (brand/Header, brand/Footer, layout/Dashboard)",
      "Approve?",
    ]);
  });

  test("echoes the input it is starting with", async () => {
    const { host, io } = approvingRun();

    await runDemo(host, io);

    expect(io.transcript).toContain("designFile: homepage.fig");
    expect(io.transcript).toContain("framework: react");
    expect(io.transcript).toContain(
      "frames: brand/Header, brand/Footer, layout/Dashboard",
    );
  });

  test("falls back to the placeholder when a field is left blank", async () => {
    const host = createDemoHost();
    const io = new ScriptedIO(["1", "", "", "", "approve"]);

    const result = await runDemo(host, io);

    // Pressing through the form still produces a working run.
    expect(result.state).toBe("ready");
    expect(io.transcript).toContain("designFile: homepage.fig");
  });

  test("produces a real execution", async () => {
    const { host, io } = approvingRun();

    const result = await runDemo(host, io);

    expect(result.executionId.length).toBeGreaterThan(0);
    expect(result.state).toBe("ready");
  });
});

// ── 3. Progress updates are displayed ───────────────────────────

describe("progress", () => {
  test("redraws the checklist as steps land", async () => {
    const { host, io } = approvingRun();

    await runDemo(host, io);

    // Live frames arrive while `start` is awaited, one per state change.
    expect(io.frames.length).toBeGreaterThan(1);
    expect(io.frames[0]).toContain("Running");
    expect(io.frames.at(-1)).toContain("Validate output");
  });

  test("shows each step moving from pending to active to done", async () => {
    const { host, io } = approvingRun();

    await runDemo(host, io);

    const combined = io.frames.join("\n");
    expect(combined).toContain("→ Analyze design");
    expect(combined).toContain("✓ Analyze design");
  });

  test("ends with every step complete", async () => {
    const { host, io } = approvingRun();

    await runDemo(host, io);

    expect(io.transcript).toContain("✓ Analyze design");
    expect(io.transcript).toContain("✓ Extract design tokens");
    expect(io.transcript).toContain("✓ Create component structure");
    expect(io.transcript).toContain("✓ Generate code");
    expect(io.transcript).toContain("✓ Validate output");
    expect(io.transcript).toContain("5 of 5 steps");
  });

  test("marks unreached steps as pending", () => {
    const frame = renderProgress("Design → Code", {
      completed: 2,
      total: 5,
      percent: 40,
      currentStep: "Create component structure",
      steps: [
        { label: "Analyze design", status: "done" },
        { label: "Extract design tokens", status: "done" },
        { label: "Create component structure", status: "active" },
        { label: "Generate code", status: "pending" },
        { label: "Validate output", status: "pending" },
      ],
    });

    expect(frame).toContain("✓ Analyze design");
    expect(frame).toContain("→ Create component structure");
    expect(frame).toContain("○ Generate code");
    expect(frame).toContain("2 of 5 steps");
  });
});

// ── 4. Approval action works ────────────────────────────────────

describe("approval", () => {
  test("asks before generating production code", async () => {
    const { host, io } = approvingRun();

    await runDemo(host, io);

    expect(io.transcript).toContain("Approval Required");
    expect(io.transcript).toContain("Generate production code files");
    expect(io.transcript).toContain("approve-code-generation");
  });

  test("approving completes the workflow", async () => {
    const { host, io } = approvingRun();

    const result = await runDemo(host, io);

    expect(result.approved).toBe(true);
    expect(result.state).toBe("ready");
    expect(io.transcript).toContain("Approved.");
    expect(io.transcript).toContain("Workflow Complete");
  });

  test("rejecting stops the workflow", async () => {
    const host = createDemoHost();
    const io = new ScriptedIO(["1", ...DESIGN_ANSWERS, "reject"]);

    const result = await runDemo(host, io);

    expect(result.approved).toBe(false);
    expect(result.state).toBe("failed");
    expect(io.transcript).toContain("Rejected.");
    expect(io.transcript).toContain("Workflow Stopped");
  });

  test("a rejected run produces no source code", async () => {
    const host = createDemoHost();
    const io = new ScriptedIO(["1", ...DESIGN_ANSWERS, "reject"]);

    const result = await runDemo(host, io);

    expect(
      result.report?.artifacts.some(
        (artifact) => artifact.artifactId === "source-code",
      ),
    ).toBe(false);
  });

  test("skips the approval step when the gate is off", async () => {
    const host = createDemoHost({ requireApproval: false });
    const io = new ScriptedIO(["1", ...DESIGN_ANSWERS]);

    const result = await runDemo(host, io);

    expect(result.approved).toBeUndefined();
    expect(io.transcript).not.toContain("Approval Required");
    expect(result.state).toBe("ready");
  });
});

// ── 5. Completed execution displays artifacts ───────────────────

describe("completion summary", () => {
  test("reports what the run created and reused", async () => {
    const { host, io } = approvingRun();

    await runDemo(host, io);

    expect(io.transcript).toContain("Workflow Complete");
    expect(io.transcript).toContain("Created:");
    expect(io.transcript).toContain("Reused:");
  });

  test("lists the artifacts by name", async () => {
    const { host, io } = approvingRun();

    await runDemo(host, io);

    for (const name of [
      "Design analysis",
      "Design tokens",
      "Component structure",
      "Generated source code",
      "Validation report",
    ]) {
      expect(io.transcript).toContain(name);
    }
  });

  test("shows which capability produced each artifact", async () => {
    const { host, io } = approvingRun();

    await runDemo(host, io);

    expect(io.transcript).toContain("by extract-design-tokens");
    expect(io.transcript).toContain("by generate-code");
  });

  test("shows what each artifact was built from", async () => {
    const { host, io } = approvingRun();

    await runDemo(host, io);

    expect(io.transcript).toContain("from Design analysis");
  });

  test("counts come from the engine, not the demo", async () => {
    const { host, io } = approvingRun();

    const result = await runDemo(host, io);

    const created = result.report?.overview.artifacts.created ?? 0;
    expect(io.transcript).toContain(`Created: ${created}`);
  });
});

// ── 6. Explanation data renders ─────────────────────────────────

describe("explanation", () => {
  test("narrates the run in plain language", async () => {
    const { host, io } = approvingRun();

    await runDemo(host, io);

    expect(io.transcript).toContain("What DesignFlow did");
    expect(io.transcript).toContain("Started workflow");
    expect(io.transcript).toContain("Completed successfully");
  });

  test("shows a timeline with clock times", async () => {
    const { host, io } = approvingRun();

    await runDemo(host, io);

    expect(io.transcript).toContain("Timeline");
    expect(io.transcript).toMatch(/\d{2}:\d{2}\s+Started workflow/);
  });

  test("every rendered line traces to the report", async () => {
    const { host, io } = approvingRun();

    const result = await runDemo(host, io);

    for (const entry of result.report?.narration ?? []) {
      expect(io.transcript).toContain(entry.message);
    }
  });
});

// ── Architecture rule ───────────────────────────────────────────

describe("architecture", () => {
  test("only the composition root imports the engine", () => {
    const sourceDir = join(import.meta.dir);
    const offenders: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);

        if (statSync(path).isDirectory()) {
          walk(path);
          continue;
        }

        if (!entry.endsWith(".ts")) continue;
        if (entry === "host.ts" || entry.endsWith(".test.ts")) continue;

        if (readFileSync(path, "utf8").includes("@designflow/core")) {
          offenders.push(entry);
        }
      }
    };

    walk(sourceDir);

    // The demo consumes DesignFlow through the product layer. Wiring concrete
    // implementations is unavoidable somewhere; confining it to host.ts is
    // what keeps that true of the application rather than merely intended.
    expect(offenders).toEqual([]);
  });

  test("the catalogue drives the screens", () => {
    expect(DEMO_WORKFLOWS).toHaveLength(1);
    expect(DEMO_WORKFLOWS[0]?.fields.map((field) => field.key)).toEqual([
      "designFile",
      "framework",
      "frames",
    ]);
  });
});

// ── Artifact visualization ──────────────────────────────────────

describe("artifact visualization", () => {
  test("lists named outputs and counts stored payloads separately", async () => {
    const { host, io } = approvingRun();

    const result = await runDemo(host, io);

    // Each capability registers a content-addressed payload alongside its
    // named output. Listing hashes beside "Design tokens" makes the summary
    // unreadable, so they are counted instead.
    expect(io.transcript).toContain("stored payloads not listed");
    expect(io.transcript).not.toMatch(/^ {2}[0-9a-f]{64} {2}\(/m);

    const named = (result.report?.artifacts ?? []).filter(
      (artifact) => artifact.name !== artifact.artifactId,
    );
    expect(named).toHaveLength(5);
  });

  test("the counted total reconciles with the engine's own", async () => {
    const { host, io } = approvingRun();

    const result = await runDemo(host, io);

    const total = result.report?.artifacts.length ?? 0;
    const named = (result.report?.artifacts ?? []).filter(
      (artifact) => artifact.name !== artifact.artifactId,
    ).length;

    expect(io.transcript).toContain(`(${total - named} stored payloads not listed)`);
  });
});
