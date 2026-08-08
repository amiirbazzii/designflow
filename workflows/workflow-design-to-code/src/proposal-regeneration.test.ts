// workflows/workflow-design-to-code/src/proposal-regeneration.test.ts
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ArtifactRef, ArtifactStore, CapabilityContext } from "@designflow/sdk";
import { inspectRegisteredProject } from "@designflow/capability-implementation";

import {
  invokeImplementationAgentStage4Capability,
  MAX_CORRECTION_PROPOSAL_ATTEMPTS,
  REPAIRABLE_PROPOSAL_ERROR_CODES,
} from "./implementation-capabilities";
import { IMPLEMENTATION_ARTIFACT_IDS } from "./implementation-types";

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "designflow-regen-"));
  await mkdir(join(root, "src/components"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "regen-fixture", dependencies: { react: "18.0.0" }, scripts: { build: "bun --version" } }));
  await writeFile(join(root, "src/App.jsx"), "export default function App() { return null; }\n");
  await writeFile(join(root, "src/components/Existing.jsx"), "export default function Existing() { return null; }\n");
  return root;
}

const SPEC = {
  schemaVersion: "2", sourceIdentity: { designFile: "file" }, frames: [], hierarchy: [{ id: "n1", name: "Frame" }],
  designTokens: { colors: [], spacing: [], typography: [], radii: [], borders: [], shadows: [], referencedVariableNames: [] },
  components: [], layoutBehavior: [], responsiveAssumptions: [], assets: [], content: [], interactions: [], states: [],
  accessibilityNotes: [], ambiguities: [], agentVersion: "1",
};
const MAPPING = { schemaVersion: "1", tokenMappings: [], componentMappings: [], assetMappings: [], unresolved: [] };

function store(): ArtifactStore & { saved: Map<string, unknown> } {
  const payloads = new Map<string, unknown>();
  return {
    saved: payloads,
    async save(data: unknown) { const id = `payload-${payloads.size}`; payloads.set(id, data); return { id, data }; },
    async get(id: string) { const data = payloads.get(id); return data === undefined ? null : { id, data }; },
    async exists(id: string) { return payloads.has(id); },
  };
}

async function contextFor(root: string, invocations: unknown[], outputs: Array<Record<string, unknown> | Error>, signal?: AbortSignal): Promise<CapabilityContext> {
  const artifactStore = store();
  const parentArtifacts: ArtifactRef[] = [];
  const addArtifact = async (artifactId: string, payload: unknown): Promise<void> => {
    const stored = await artifactStore.save(payload, {});
    parentArtifacts.push({ id: artifactId, type: "test", metadata: { payloadId: stored.id } });
  };
  await addArtifact("design-specification", SPEC);
  await addArtifact(IMPLEMENTATION_ARTIFACT_IDS.projectContext, inspectRegisteredProject({ id: "p1", name: "Fixture", rootPath: root }));
  await addArtifact(IMPLEMENTATION_ARTIFACT_IDS.mapping, MAPPING);

  return {
    executionId: "regen-exec", workflowId: "design-to-code-implementation", capabilityId: "invoke-implementation-agent",
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    artifactRefs: [], parentArtifacts, artifactStore, config: {},
    signal: signal ?? new AbortController().signal,
    agents: {
      async invoke(request: unknown) {
        invocations.push(request);
        const next = outputs[invocations.length - 1];
        if (next === undefined) throw new Error("Unexpected extra agent invocation.");
        if (next instanceof Error) throw next;
        return { type: "success", output: next } as never;
      },
    } as never,
  };
}

function workflowInput(root: string) {
  return { enabled: true as const, designFile: "file.fig", frames: [], project: { id: "p1", name: "Fixture", rootPath: root }, stateDirectory: join(root, ".state"), captureScreenshots: false, refreshFigmaSource: false, allowFixtureNames: false, figmaAgentVersion: "0.1.0", implementationAgentVersion: "0.1.0", implementationAgentModelProfileId: "implementation-default" };
}

function agentOutput(files: Array<{ path: string; action: "create" | "modify"; content?: string }>): Record<string, unknown> {
  return { files: files.map((file) => ({ path: file.path, action: file.action, content: file.content ?? "export const x = 1;\n", reason: "test" })), assumptions: [], unresolvedItems: [], implementationVersion: "0.1.0" };
}

describe("bounded proposal regeneration", () => {
  test("invalid attempt 1 regenerates with structured feedback and attempt 2 succeeds", async () => {
    const root = await fixtureRoot();
    const invocations: unknown[] = [];
    const context = await contextFor(root, invocations, [
      agentOutput([{ path: "src/components/Existing.jsx", action: "create" }]),
      agentOutput([{ path: "src/components/New.jsx", action: "create" }]),
    ]);

    const output = await invokeImplementationAgentStage4Capability.execute(context, workflowInput(root));

    expect(invocations.length).toBe(2);
    const second = invocations[1] as { attempt: number; input: { proposalRepairFeedback?: { attempt: number; maxAttempts: number; validationErrors: Array<{ code: string; path?: string; fact?: string }> } } };
    expect(second.attempt).toBe(2);
    const feedback = second.input.proposalRepairFeedback!;
    expect(feedback.maxAttempts).toBe(MAX_CORRECTION_PROPOSAL_ATTEMPTS);
    expect(feedback.validationErrors[0]!.code).toBe("ERR_PROPOSAL_TARGET_EXISTS");
    expect(feedback.validationErrors[0]!.path).toBe("src/components/Existing.jsx");
    expect(feedback.validationErrors[0]!.fact).toBe("target already exists as a regular file");
    // Facts only — the feedback never dictates a rewritten operation.
    expect(JSON.stringify(feedback)).not.toContain("change create to modify");

    expect(output.artifactRef.metadata.proposalAttempts).toBe(2);
    expect((output.artifactRef.metadata.failedAttempts as unknown[]).length).toBe(1);
    await rm(root, { recursive: true, force: true });
  });

  test("three invalid attempts exhaust the bound with no fourth call", async () => {
    const root = await fixtureRoot();
    const invocations: unknown[] = [];
    const bad = agentOutput([{ path: "src/components/Missing.jsx", action: "modify" }]);
    const context = await contextFor(root, invocations, [bad, bad, bad, bad]);

    await expect(
      invokeImplementationAgentStage4Capability.execute(context, workflowInput(root)),
    ).rejects.toMatchObject({
      code: "ERR_PROPOSAL_ATTEMPTS_EXHAUSTED",
      metadata: expect.objectContaining({ attempts: 3, attemptsExhausted: true }),
    });
    expect(invocations.length).toBe(3);
    await rm(root, { recursive: true, force: true });
  });

  test("attempt 1 invalid, attempt 2 invalid, attempt 3 valid succeeds within one iteration", async () => {
    const root = await fixtureRoot();
    const invocations: unknown[] = [];
    const context = await contextFor(root, invocations, [
      agentOutput([{ path: "/src/abs.jsx", action: "create" }]),
      agentOutput([{ path: "src/components/Existing.jsx", action: "create" }]),
      agentOutput([{ path: "src/components/Third.jsx", action: "create" }]),
    ]);

    const output = await invokeImplementationAgentStage4Capability.execute(context, workflowInput(root));
    expect(invocations.length).toBe(3);
    expect(output.artifactRef.metadata.proposalAttempts).toBe(3);
    const failed = output.artifactRef.metadata.failedAttempts as Array<{ attempt: number; code: string }>;
    expect(failed.map((entry) => entry.code)).toEqual(["ERR_UNSAFE_PATH", "ERR_PROPOSAL_TARGET_EXISTS"]);
    expect(failed.map((entry) => entry.attempt)).toEqual([1, 2]);
    await rm(root, { recursive: true, force: true });
  });

  test("cancellation after attempt 1 prevents attempt 2", async () => {
    const root = await fixtureRoot();
    const invocations: unknown[] = [];
    const controller = new AbortController();
    const context = await contextFor(root, invocations, [
      agentOutput([{ path: "src/components/Existing.jsx", action: "create" }]),
    ], controller.signal);
    // The fake agent aborts the run as its side effect, as a user Ctrl+C would.
    const originalInvoke = (context.agents as { invoke: (request: unknown) => Promise<unknown> }).invoke.bind(context.agents);
    (context.agents as { invoke: (request: unknown) => Promise<unknown> }).invoke = async (request: unknown) => {
      const result = await originalInvoke(request);
      controller.abort();
      return result;
    };

    await expect(
      invokeImplementationAgentStage4Capability.execute(context, workflowInput(root)),
    ).rejects.toMatchObject({ code: "ERR_PROPOSAL_ATTEMPT_CANCELLED" });
    expect(invocations.length).toBe(1);
    await rm(root, { recursive: true, force: true });
  });

  test("non-repairable failures terminate immediately without regeneration", async () => {
    expect(REPAIRABLE_PROPOSAL_ERROR_CODES.has("ERR_PROJECT_ROOT_INACCESSIBLE")).toBe(false);
    const root = await fixtureRoot();
    const invocations: unknown[] = [];
    const context = await contextFor(root, invocations, [
      agentOutput([{ path: "src/components/New.jsx", action: "create" }]),
    ]);
    await rm(root, { recursive: true, force: true });

    await expect(
      invokeImplementationAgentStage4Capability.execute(context, workflowInput(root)),
    ).rejects.toMatchObject({ code: "ERR_PROJECT_ROOT_INACCESSIBLE" });
    expect(invocations.length).toBe(1);
  });
});

describe("MVP-4L proposed-module compile validation in the bounded loop", () => {
  const DEFAULT_IMPORT = `import TextField from "./components/TextField.tsx";\nexport default function GeneratedScreen() { return TextField; }\n`;
  const NAMED_IMPORT = `import { TextField } from "./components/TextField.tsx";\nexport default function GeneratedScreen() { return TextField; }\n`;

  async function compileFixtureRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "designflow-regen-compile-"));
    await mkdir(join(root, "src/components"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "regen-compile-fixture", scripts: { build: "bun build ./designflow-proposed-entry.js --outdir=dist" } }));
    await writeFile(join(root, "index.html"), `<script type="module" src="/src/main.jsx"></script>`);
    await writeFile(join(root, "src/main.jsx"), `import App from "./App.jsx";\nexport default App;\n`);
    await writeFile(join(root, "src/App.jsx"), "export default function App() { return null; }\n");
    await writeFile(join(root, "src/components/TextField.tsx"), "export const TextField = () => null;\n");
    return root;
  }

  test("a compile-invalid attempt regenerates with module diagnostics and the repaired attempt succeeds", async () => {
    const root = await compileFixtureRoot();
    const invocations: unknown[] = [];
    try {
      const context = await contextFor(root, invocations, [
        agentOutput([{ path: "src/GeneratedScreen.jsx", action: "create", content: DEFAULT_IMPORT }]),
        agentOutput([{ path: "src/GeneratedScreen.jsx", action: "create", content: NAMED_IMPORT }]),
      ]);
      const output = await invokeImplementationAgentStage4Capability.execute(context, workflowInput(root));
      expect(invocations.length).toBe(2);
      const feedback = (invocations[1] as { input: { proposalRepairFeedback?: { validationErrors: Array<{ code: string; moduleDiagnostics?: Array<{ message: string }> }> } } }).input.proposalRepairFeedback;
      expect(feedback?.validationErrors[0]?.code).toBe("ERR_PROPOSAL_MODULE_COMPILE_FAILED");
      expect((feedback?.validationErrors[0]?.moduleDiagnostics ?? []).map((d) => d.message).join("\n")).toContain("No matching export");
      expect(output.artifactRef.metadata.proposalAttempts).toBe(2);
      expect(existsSync(join(root, "src/GeneratedScreen.jsx"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("three compile-invalid attempts exhaust honestly with zero project writes", async () => {
    const root = await compileFixtureRoot();
    const invocations: unknown[] = [];
    try {
      const context = await contextFor(root, invocations, [
        agentOutput([{ path: "src/GeneratedScreen.jsx", action: "create", content: DEFAULT_IMPORT }]),
        agentOutput([{ path: "src/GeneratedScreen.jsx", action: "create", content: DEFAULT_IMPORT }]),
        agentOutput([{ path: "src/GeneratedScreen.jsx", action: "create", content: DEFAULT_IMPORT }]),
      ]);
      await expect(invokeImplementationAgentStage4Capability.execute(context, workflowInput(root))).rejects.toMatchObject({ code: "ERR_PROPOSAL_ATTEMPTS_EXHAUSTED" });
      expect(invocations.length).toBe(3);
      expect(existsSync(join(root, "src/GeneratedScreen.jsx"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
