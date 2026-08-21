import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import type { FreshFrameEvidence } from "./fresh-figma-evidence";
import { scaffoldFreshUiProject } from "./fresh-project-scaffolder";
import {
  FreshGenerationError,
  generateFreshUiProject,
  type FreshBuildResult,
} from "./fresh-ui-generation";

const evidence = {
  schemaVersion: "1",
  frame: { id: "10:20", name: "Checkout", path: ["Page", "Checkout"], width: 800, height: 600 },
  snapshot: {
    source: { designFile: "Checkout", resolvedFrames: [{ id: "10:20", name: "Checkout", path: ["Page", "Checkout"] }] },
    nodes: [{
      id: "10:20",
      name: "Checkout",
      type: "FRAME",
      childIds: [],
      absoluteBoundingBox: { x: 0, y: 0, width: 800, height: 600 },
      fills: [],
      strokes: [],
      effects: [],
      properties: {},
    }],
    variables: [], styles: [], components: [], assets: [], screenshots: [], warnings: [], capabilities: {}, provenance: {},
  },
  specificationEvidence: { visibleText: ["Checkout"], hierarchy: [], layout: {}, styles: {} },
} as unknown as FreshFrameEvidence;

const proposal = (overrides: Record<string, unknown> = {}) => ({
  files: [
    { path: "src/App.tsx", action: "modify", content: "export default function App(){return <main>Checkout</main>}", reason: "frame", relatedDesignNodeIds: [] },
    { path: "src/styles.css", action: "modify", content: "main { color: #111; }", reason: "frame", relatedDesignNodeIds: [] },
  ],
  assumptions: [],
  unresolvedItems: [],
  unexecutableReason: undefined,
  ...overrides,
});

async function scaffold() {
  const root = await mkdtemp(join(tmpdir(), "designflow-fresh-phase4-"));
  const result = await scaffoldFreshUiProject({ evidence, outputRoot: root });
  return { root, result };
}

describe("Fresh UI generation", () => {
  it("writes only a valid proposal and builds successfully", async () => {
    const { root, result } = await scaffold();
    try {
      const builds: FreshBuildResult[] = [{ passed: true, stdout: "ok", stderr: "", exitCode: 0 }];
      const generated = await generateFreshUiProject({
        evidence,
        scaffold: result,
        invokeBuilder: async () => proposal(),
        runBuild: async () => builds.shift()!,
      });
      expect(generated.repairAttempts).toBe(0);
      expect(generated.generatedFiles).toEqual(["src/App.tsx", "src/styles.css"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects traversal and config/package proposals before writing", async () => {
    const { root, result } = await scaffold();
    try {
      for (const badPath of ["../escape.ts", "package.json", "vite.config.ts", "/tmp/escape.ts"]) {
        await expect(generateFreshUiProject({
          evidence,
          scaffold: result,
          invokeBuilder: async () => proposal({ files: [{ ...proposal().files[0], path: badPath }, proposal().files[1] ] }),
          runBuild: async () => ({ passed: true, stdout: "", stderr: "", exitCode: 0 }),
        })).rejects.toMatchObject({ code: "ERR_FRESH_UI_PROPOSAL_DISALLOWED" });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a scaffold target outside its approved output root", async () => {
    const { root, result } = await scaffold();
    try {
      await expect(generateFreshUiProject({
        evidence,
        scaffold: { ...result, outputRoot: join(root, "different-root") },
        invokeBuilder: async () => proposal(),
      })).rejects.toMatchObject({ code: "ERR_FRESH_UI_PROPOSAL_DISALLOWED" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects symlinked implementation targets", async () => {
    const { root, result } = await scaffold();
    const outside = await mkdtemp(join(tmpdir(), "designflow-fresh-outside-"));
    try {
      await rm(join(result.targetPath, "src/App.tsx"));
      await symlink(join(outside, "App.tsx"), join(result.targetPath, "src/App.tsx"));
      await expect(generateFreshUiProject({
        evidence,
        scaffold: result,
        invokeBuilder: async () => proposal(),
        runBuild: async () => ({ passed: true, stdout: "", stderr: "", exitCode: 0 }),
      })).rejects.toMatchObject({ code: "ERR_FRESH_UI_PROPOSAL_DISALLOWED" });
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("repairs a compile failure at most twice", async () => {
    const { root, result } = await scaffold();
    try {
      let calls = 0;
      let builds = 0;
      const generated = await generateFreshUiProject({
        evidence,
        scaffold: result,
        invokeBuilder: async () => { calls += 1; return proposal(); },
        runBuild: async () => {
          builds += 1;
          return builds < 3
            ? { passed: false, stdout: "", stderr: "TS1005", exitCode: 1 }
            : { passed: true, stdout: "ok", stderr: "", exitCode: 0 };
        },
      });
      expect(calls).toBe(3);
      expect(generated.repairAttempts).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports repair exhaustion with bounded diagnostics", async () => {
    const { root, result } = await scaffold();
    try {
      await expect(generateFreshUiProject({
        evidence,
        scaffold: result,
        invokeBuilder: async () => proposal(),
        runBuild: async () => ({ passed: false, stdout: "", stderr: "compile failed", exitCode: 1 }),
      })).rejects.toMatchObject({ code: "ERR_FRESH_UI_REPAIR_EXHAUSTED" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not invoke a builder when the proposal schema is malformed", async () => {
    const { root, result } = await scaffold();
    try {
      await expect(generateFreshUiProject({
        evidence,
        scaffold: result,
        invokeBuilder: async () => ({ files: [] }),
        runBuild: async () => ({ passed: true, stdout: "", stderr: "", exitCode: 0 }),
      })).rejects.toBeInstanceOf(FreshGenerationError);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails before Builder invocation when detailed Figma context is incomplete", async () => {
    const { root, result } = await scaffold();
    try {
      let invoked = false;
      const incomplete = {
        ...evidence,
        snapshot: {
          ...evidence.snapshot,
          warnings: [{ code: "DESIGN_CONTEXT_RETRIEVAL_FAILED", message: "timed out" }],
        },
      } as FreshFrameEvidence;
      await expect(generateFreshUiProject({
        evidence: incomplete,
        scaffold: result,
        invokeBuilder: async () => { invoked = true; return proposal(); },
        runBuild: async () => ({ passed: true, stdout: "", stderr: "", exitCode: 0 }),
      })).rejects.toMatchObject({ code: "ERR_FRESH_UI_EVIDENCE_INCOMPLETE" });
      expect(invoked).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves provider unavailable and quota classifications", async () => {
    const { root, result } = await scaffold();
    try {
      await expect(generateFreshUiProject({
        evidence,
        scaffold: result,
        invokeBuilder: async () => { throw Object.assign(new Error("quota"), { code: "ERR_MODEL_QUOTA_EXCEEDED" }); },
      })).rejects.toMatchObject({ code: "ERR_FRESH_UI_AI_QUOTA" });
      await expect(generateFreshUiProject({
        evidence,
        scaffold: result,
        invokeBuilder: async () => { throw Object.assign(new Error("offline"), { code: "ERR_MODEL_UNAVAILABLE" }); },
      })).rejects.toMatchObject({ code: "ERR_FRESH_UI_AI_UNAVAILABLE" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accepts the provider's nullable unexecutableReason field", async () => {
    const { root, result } = await scaffold();
    try {
      const generated = await generateFreshUiProject({
        evidence,
        scaffold: result,
        invokeBuilder: async () => ({ ...proposal(), unexecutableReason: null }),
        runBuild: async () => ({ passed: true, stdout: "", stderr: "", exitCode: 0 }),
      });
      expect(generated.build.passed).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("classifies model timeout and cancellation separately", async () => {
    const { root, result } = await scaffold();
    try {
      await expect(generateFreshUiProject({
        evidence,
        scaffold: result,
        invokeBuilder: async () => { throw Object.assign(new Error("timed out"), { code: "ERR_MODEL_TIMEOUT" }); },
      })).rejects.toMatchObject({ code: "ERR_FRESH_UI_AI_TIMEOUT" });
      await expect(generateFreshUiProject({
        evidence,
        scaffold: result,
        invokeBuilder: async () => { throw Object.assign(new Error("aborted"), { code: "ERR_MODEL_ABORTED" }); },
      })).rejects.toMatchObject({ code: "ERR_FRESH_UI_BUILD_CANCELLED" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("invokes dependency installation as a host operation before build", async () => {
    const { root, result } = await scaffold();
    try {
      const calls: string[] = [];
      await generateFreshUiProject({
        evidence,
        scaffold: result,
        invokeBuilder: async () => proposal(),
        installDependencies: async () => { calls.push("install"); return { passed: true, stdout: "", stderr: "", exitCode: 0 }; },
        runBuild: async () => { calls.push("build"); return { passed: true, stdout: "", stderr: "", exitCode: 0 }; },
      });
      expect(calls).toEqual(["install", "build"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("projects only Fresh evidence and fixed host constraints to the Builder", async () => {
    const { root, result } = await scaffold();
    try {
      let captured: Record<string, unknown> | undefined;
      await generateFreshUiProject({
        evidence,
        scaffold: result,
        invokeBuilder: async (input) => { captured = input as unknown as Record<string, unknown>; return proposal(); },
        runBuild: async () => ({ passed: true, stdout: "", stderr: "", exitCode: 0 }),
      });
      expect(captured?.projectId).toBeUndefined();
      expect(captured?.baseProjectFingerprint).toBeUndefined();
      expect(captured?.allowedWritePaths).toEqual(["src/App.tsx", "src/styles.css", "src/assets/**"]);
      expect(captured?.fixedStack).toEqual(["Vite", "React", "TypeScript", "Plain CSS"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("stops before a build when the host signal is cancelled", async () => {
    const { root, result } = await scaffold();
    try {
      const controller = new AbortController();
      controller.abort();
      await expect(generateFreshUiProject({
        evidence,
        scaffold: result,
        signal: controller.signal,
        invokeBuilder: async () => proposal(),
        runBuild: async () => ({ passed: true, stdout: "", stderr: "", exitCode: 0 }),
      })).rejects.toMatchObject({ code: "ERR_FRESH_UI_BUILD_CANCELLED" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("classifies cancellation during dependency installation", async () => {
    const { root, result } = await scaffold();
    try {
      const controller = new AbortController();
      await expect(generateFreshUiProject({
        evidence,
        scaffold: result,
        signal: controller.signal,
        invokeBuilder: async () => proposal(),
        installDependencies: async () => {
          controller.abort();
          return { passed: false, stdout: "", stderr: "cancelled", exitCode: null };
        },
      })).rejects.toMatchObject({ code: "ERR_FRESH_UI_BUILD_CANCELLED" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
