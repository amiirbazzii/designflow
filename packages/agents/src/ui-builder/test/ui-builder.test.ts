// packages/agents/src/ui-builder/test/ui-builder.test.ts
//
// V2-4 acceptance: the Builder executes a plan it cannot change, and nothing
// that violates the plan, misses a requirement or leaves the screen
// unreachable ever becomes a proposal a person could approve.
import { describe, expect, test } from "bun:test";
import type { ProposedFileChanges, SpecializedAgentContext } from "@designflow/sdk";

import {
  BLUEPRINT,
  BUTTON_PATH,
  DESTINATION_PATH,
  HISTORY_PATH,
  MIXED_MAP,
  NAV_PATH,
  PROJECT,
  SPENDLY_COPY,
  TEXTFIELD_PATH,
  scriptedBuilder,
  validProposal,
} from "./fixtures/builder-fixtures";
import { allowedWritePaths, selectBuilderSourcePaths } from "../builder-source-selection";
import { compileUIBuilderEvidence } from "../builder-evidence-compiler";
import { enforceImplementationMap } from "../map-enforcement";
import { checkReachability, deriveBuilderCoverage } from "../builder-coverage";
import { buildImplementation, MAX_BUILDER_ATTEMPTS } from "../builder-pipeline";
import { renderBuilderReport } from "../builder-report";
import {
  ImplementationMapUnexecutableError,
  MAX_BUILDER_OUTPUT_TOKENS,
  modelUIBuilderStrategy,
  uiBuilderAgentManifest,
  uiBuilderDefaultModelProfile,
} from "../ui-builder-agent";

function mutate(proposal: ProposedFileChanges, change: (files: ProposedFileChanges["files"]) => ProposedFileChanges["files"]): ProposedFileChanges {
  return { ...proposal, files: change([...proposal.files]) };
}

// ── Host-selected context ───────────────────────────────────────

describe("the host decides what the Builder may see and write", () => {
  test("source selection comes from the map, and reuse targets are read-only", () => {
    const selected = selectBuilderSourcePaths(MIXED_MAP);
    const byPath = new Map(selected.map((entry) => [entry.path, entry]));

    expect(byPath.get(BUTTON_PATH)).toMatchObject({ reason: "reuse-target", writable: false });
    expect(byPath.get(NAV_PATH)?.writable).toBe(false);
    expect(byPath.get(TEXTFIELD_PATH)).toMatchObject({ reason: "extend-target", writable: true });
    expect(selected.some((entry) => entry.reason === "composition-root")).toBe(true);
  });

  test("the write allow-list is exactly what the plan authorized", () => {
    const allowed = allowedWritePaths(MIXED_MAP);
    expect(allowed).toContain(TEXTFIELD_PATH);
    expect(allowed).toContain(HISTORY_PATH);
    expect(allowed).not.toContain(BUTTON_PATH);
    expect(allowed).not.toContain(NAV_PATH);
  });

  test("the request carries the plan, the design and only the selected sources", () => {
    const evidence = compileUIBuilderEvidence({
      blueprint: BLUEPRINT,
      map: MIXED_MAP,
      context: PROJECT,
      sourceExcerpts: [{ path: BUTTON_PATH, content: "export function Button() { return null; }", hash: "h1" }],
    });
    const serialized = JSON.stringify(evidence);

    expect(serialized).toContain("Enter amount");
    expect(serialized).toContain("allowedWritePaths");
    expect(serialized).toContain("export function Button");
    // no repository inventory, no secrets, no legacy prose specification
    expect(serialized).not.toContain("OPENROUTER");
    expect(serialized).not.toContain("designSpecification");
    expect(evidence.relevantFileCount).toBeLessThanOrEqual(16);
  });
});

// ── Map enforcement ─────────────────────────────────────────────

describe("the Implementation Map is immutable input", () => {
  test("a valid proposal violates nothing", () => {
    expect(enforceImplementationMap(validProposal(), MIXED_MAP, BLUEPRINT)).toEqual([]);
  });

  test("A: creating a component the map said to reuse is rejected", () => {
    const proposal = mutate(validProposal(), (files) => [
      ...files,
      { path: "src/components/NewButton.tsx", action: "create", content: "export function NewButton() { return null; }", reason: "nicer", relatedDesignNodeIds: [] },
    ]);
    const codes = enforceImplementationMap(proposal, MIXED_MAP, BLUEPRINT).map((violation) => violation.code);
    expect(codes).toContain("ERR_IMPLEMENTATION_MAP_VIOLATION_SUBSTITUTE_COMPONENT");
  });

  test("A2: modifying a reused component is rejected", () => {
    const proposal = mutate(validProposal(), (files) => [
      ...files,
      { path: BUTTON_PATH, action: "modify", content: "export function Button() { return null; }", reason: "tweak", relatedDesignNodeIds: [] },
    ]);
    const codes = enforceImplementationMap(proposal, MIXED_MAP, BLUEPRINT).map((violation) => violation.code);
    expect(codes).toContain("ERR_IMPLEMENTATION_MAP_VIOLATION_REUSE_MODIFIED");
  });

  test("B: modifying an unrelated project file is rejected", () => {
    const proposal = mutate(validProposal(), (files) => [
      ...files,
      { path: "src/lib/analytics.ts", action: "modify", content: "export const x = 1;", reason: "unrelated", relatedDesignNodeIds: [] },
    ]);
    const codes = enforceImplementationMap(proposal, MIXED_MAP, BLUEPRINT).map((violation) => violation.code);
    expect(codes).toContain("ERR_IMPLEMENTATION_MAP_VIOLATION_UNAUTHORIZED_FILE");
  });

  test("C: never importing the reused component is rejected", () => {
    const proposal = mutate(validProposal(), (files) =>
      files.map((file) => (file.path === DESTINATION_PATH ? { ...file, content: file.content!.replace(/import \{ Button \}.*\n/, "") } : file)),
    );
    const codes = enforceImplementationMap(proposal, MIXED_MAP, BLUEPRINT).map((violation) => violation.code);
    expect(codes).toContain("ERR_IMPLEMENTATION_MAP_VIOLATION_SUBSTITUTE_COMPONENT");
  });

  test("D: ignoring the required extend target is rejected", () => {
    const proposal = mutate(validProposal(), (files) => files.filter((file) => file.path !== TEXTFIELD_PATH));
    const codes = enforceImplementationMap(proposal, MIXED_MAP, BLUEPRINT).map((violation) => violation.code);
    expect(codes).toContain("ERR_IMPLEMENTATION_MAP_VIOLATION_MISSING_EXTENSION");
  });

  test("E: writing the screen somewhere else is rejected", () => {
    const proposal = mutate(validProposal(), (files) =>
      files.map((file) => (file.path === DESTINATION_PATH ? { ...file, path: "src/pages/elsewhere.tsx" } : file)),
    );
    const codes = enforceImplementationMap(proposal, MIXED_MAP, BLUEPRINT).map((violation) => violation.code);
    expect(codes).toContain("ERR_IMPLEMENTATION_MAP_VIOLATION_DESTINATION");
    expect(codes).toContain("ERR_IMPLEMENTATION_MAP_VIOLATION_UNAUTHORIZED_FILE");
  });

  test("H: dropping a mapped token is rejected", () => {
    const proposal = mutate(validProposal(), (files) =>
      files.map((file) => (file.path === DESTINATION_PATH ? { ...file, content: file.content!.replace("var(--surface-muted)", "#fafafa") } : file)),
    );
    const codes = enforceImplementationMap(proposal, MIXED_MAP, BLUEPRINT).map((violation) => violation.code);
    expect(codes).toContain("ERR_IMPLEMENTATION_MAP_VIOLATION_TOKEN");
  });

  test("H2: dropping a value the map kept raw is rejected", () => {
    const proposal = mutate(validProposal(), (files) =>
      files.map((file) => (file.path === DESTINATION_PATH ? { ...file, content: file.content!.replace("#D3D3D3", "#cccccc") } : file)),
    );
    const codes = enforceImplementationMap(proposal, MIXED_MAP, BLUEPRINT).map((violation) => violation.code);
    expect(codes).toContain("ERR_IMPLEMENTATION_MAP_VIOLATION_TOKEN");
  });

  test("J: claiming a different project state than the plan was made for is rejected", () => {
    const proposal: ProposedFileChanges = {
      ...validProposal(),
      v2Binding: {
        builderAgentId: "ui-builder-agent",
        builderAgentVersion: "0.1.0",
        builderModelProfileId: "ui-builder-default",
        attempt: 1,
        projectFingerprint: "a-different-fingerprint",
      },
    };
    const codes = enforceImplementationMap(proposal, MIXED_MAP, BLUEPRINT).map((violation) => violation.code);
    expect(codes).toContain("ERR_IMPLEMENTATION_MAP_VIOLATION_BINDING");
  });
});

// ── Coverage and reachability ───────────────────────────────────

describe("coverage is derived, never declared", () => {
  test("a complete proposal satisfies every map requirement", () => {
    const coverage = deriveBuilderCoverage(validProposal(), MIXED_MAP, BLUEPRINT);
    expect(coverage.missing).toEqual([]);
    expect(coverage.resolvedCount).toBe(coverage.requirementCount);
    expect(coverage.requirementCount).toBeGreaterThan(10);
  });

  test("I: dropping one instance's copy leaves that instance missing", () => {
    const proposal = mutate(validProposal(), (files) =>
      files.map((file) => (file.path === DESTINATION_PATH ? { ...file, content: file.content!.replace(/Who did you pay for\?/g, "") } : file)),
    );
    const coverage = deriveBuilderCoverage(proposal, MIXED_MAP, BLUEPRINT);
    expect(coverage.missing.some((entry) => entry.kind === "component-instance")).toBe(true);
    // and the model's own opinion is never consulted
    expect(JSON.stringify(coverage)).not.toContain("coverageClaims");
  });

  test("F: files that compile but never mount the screen are unreachable", () => {
    const proposal = mutate(validProposal(), (files) =>
      files.map((file) => (file.path === DESTINATION_PATH ? { ...file, path: "src/components/AddTransaction.tsx" } : file)),
    );
    const reachability = checkReachability(proposal, MIXED_MAP);
    expect(reachability.reachable).toBe(false);
    expect(reachability.reason).toContain("never writes the mapped destination");
  });

  test("a file-routed destination is reachable by convention", () => {
    const reachability = checkReachability(validProposal(), MIXED_MAP);
    expect(reachability.reachable).toBe(true);
    expect(reachability.destinationPath).toBe(DESTINATION_PATH);
  });
});

// ── The bounded build ───────────────────────────────────────────

describe("bounded build", () => {
  test("Spendly-shaped: one attempt produces a valid, fully covered, reachable proposal", async () => {
    const builder = scriptedBuilder([validProposal()]);
    const result = await buildImplementation({
      blueprint: BLUEPRINT,
      map: MIXED_MAP,
      context: PROJECT,
      projectId: "project-fixture",
      baseProjectFingerprint: "fingerprint-1",
      generate: builder.generate,
      validateProposedState: async () => ({ status: "passed", diagnostics: [] }),
    });

    expect(result.status).toBe("valid");
    expect(result.attempts).toBe(1);
    expect(result.violations).toEqual([]);
    expect(result.coverage?.missing).toEqual([]);
    expect(result.reachability?.reachable).toBe(true);

    const text = result.proposal!.files.map((file) => file.content).join("\n");
    for (const copy of SPENDLY_COPY) expect(text).toContain(copy);
    expect(result.metrics.createdFileCount).toBe(2);
    expect(result.metrics.modifiedFileCount).toBe(1);
  });

  test("repair: build failure, then a map violation, then success — same plan throughout", async () => {
    const violating = mutate(validProposal(), (files) => [
      ...files,
      { path: "src/components/NewButton.tsx", action: "create", content: "export function NewButton() { return null; }", reason: "nope", relatedDesignNodeIds: [] },
    ]);
    const builder = scriptedBuilder([validProposal(), violating, validProposal()]);
    let buildCall = 0;

    const result = await buildImplementation({
      blueprint: BLUEPRINT,
      map: MIXED_MAP,
      context: PROJECT,
      projectId: "project-fixture",
      baseProjectFingerprint: "fingerprint-1",
      generate: builder.generate,
      validateProposedState: async () => {
        buildCall += 1;
        return buildCall === 1
          ? { status: "failed", diagnostics: ["TS2304: Cannot find name 'Foo'"] }
          : { status: "passed", diagnostics: [] };
      },
    });

    expect(result.status).toBe("valid");
    expect(result.attempts).toBe(3);
    expect(builder.calls).toEqual([1, 2, 3]);
    expect(result.failures.map((failure) => failure.code)).toEqual([
      "ERR_PROPOSED_STATE_BUILD_FAILED",
      "ERR_IMPLEMENTATION_MAP_VIOLATION",
    ]);
    // the surviving proposal is the valid one, and only it
    expect(result.proposal!.files.some((file) => file.path.endsWith("NewButton.tsx"))).toBe(false);
  });

  test("every attempt receives the same immutable plan, restated as immutable", async () => {
    const seen: unknown[] = [];
    const violating = mutate(validProposal(), (files) => files.filter((file) => file.path !== TEXTFIELD_PATH));
    await buildImplementation({
      blueprint: BLUEPRINT,
      map: MIXED_MAP,
      context: PROJECT,
      projectId: "project-fixture",
      baseProjectFingerprint: "fingerprint-1",
      generate: async (evidence) => {
        seen.push(evidence);
        return violating;
      },
    });

    expect(seen).toHaveLength(MAX_BUILDER_ATTEMPTS);
    const decisions = seen.map((evidence) => JSON.stringify((evidence as { decisions: unknown }).decisions));
    expect(new Set(decisions).size).toBe(1);
    expect(JSON.stringify((seen[1] as { repair: unknown }).repair)).toContain("planIsImmutable");
  });

  test("three invalid attempts end in a typed failure with history and no proposal", async () => {
    const violating = mutate(validProposal(), (files) => files.filter((file) => file.path !== HISTORY_PATH));
    const result = await buildImplementation({
      blueprint: BLUEPRINT,
      map: MIXED_MAP,
      context: PROJECT,
      projectId: "project-fixture",
      baseProjectFingerprint: "fingerprint-1",
      generate: async () => violating,
    });

    expect(result.status).toBe("exhausted");
    expect(result.attempts).toBe(3);
    expect(result.proposal).toBeUndefined();
    expect(result.failures).toHaveLength(3);
  });

  test("an unexecutable plan is reported as such, not silently re-planned", async () => {
    const result = await buildImplementation({
      blueprint: BLUEPRINT,
      map: MIXED_MAP,
      context: PROJECT,
      projectId: "project-fixture",
      baseProjectFingerprint: "fingerprint-1",
      generate: async () => {
        throw new ImplementationMapUnexecutableError("the mapped TextField does not accept children");
      },
    });

    expect(result.status).toBe("map_unexecutable");
    expect(result.reason).toContain("does not accept children");
    expect(result.proposal).toBeUndefined();
  });

  test("an unavailable model produces no proposal and no fake code", async () => {
    const result = await buildImplementation({
      blueprint: BLUEPRINT,
      map: MIXED_MAP,
      context: PROJECT,
      projectId: "project-fixture",
      baseProjectFingerprint: "fingerprint-1",
      generate: async () => {
        throw new Error("ERR_MODEL_CANDIDATES_EXHAUSTED");
      },
    });
    expect(result.status).toBe("unavailable");
    expect(result.proposal).toBeUndefined();
  });

  test("G: a project that moved on since the plan stops before generating", async () => {
    let generated = false;
    const result = await buildImplementation({
      blueprint: BLUEPRINT,
      map: MIXED_MAP,
      context: { ...PROJECT, project: { ...PROJECT.project, contextFingerprint: "a-newer-fingerprint" } },
      projectId: "project-fixture",
      baseProjectFingerprint: "fingerprint-1",
      generate: async () => {
        generated = true;
        return validProposal();
      },
    });

    expect(result.status).toBe("stale_project");
    expect(generated).toBe(false);
    expect(result.reason).toContain("planned against project state");
  });
});

// ── The agent ───────────────────────────────────────────────────

describe("UI Builder agent", () => {
  const context = (generate: (request: { messages: readonly { content: string }[] }) => unknown): SpecializedAgentContext =>
    ({
      tools: { call: async () => { throw new Error("no tools"); } },
      metadata: {},
      signal: new AbortController().signal,
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      model: { generate: async (request: never) => generate(request) },
    }) as never;

  const evidence = compileUIBuilderEvidence({ blueprint: BLUEPRINT, map: MIXED_MAP, context: PROJECT });

  test("its own profile, no tools, measured output budget", () => {
    expect(uiBuilderDefaultModelProfile.id).toBe("ui-builder-default");
    for (const other of ["implementation-default", "project-mapper-default", "design-interpreter-default"]) {
      expect(uiBuilderDefaultModelProfile.id).not.toBe(other);
    }
    expect(uiBuilderDefaultModelProfile.model).toBe("openai/gpt-4o-mini");
    expect(uiBuilderDefaultModelProfile.timeoutMs).toBeUndefined();
    expect(MAX_BUILDER_OUTPUT_TOKENS).toBe(6000);
    expect(uiBuilderAgentManifest.allowedTools).toEqual([]);
  });

  test("a model response normalizes into the existing proposal contract with V2 provenance", async () => {
    const proposal = await modelUIBuilderStrategy(
      {
        agentId: "ui-builder-agent",
        objective: "build",
        input: { evidence, projectId: "project-fixture", baseProjectFingerprint: "fingerprint-1", attempt: 1 },
        attempt: 1,
      },
      context(() => ({
        type: "success",
        output: {
          files: [{ path: DESTINATION_PATH, action: "create", content: "export default function Page() { return null; }", reason: "the screen", relatedDesignNodeIds: ["1:1"] }],
          assumptions: [],
          unresolvedItems: [],
          unexecutableReason: null,
        },
      })),
      uiBuilderAgentManifest,
    );

    expect(proposal.schemaVersion).toBe("1");
    expect(proposal.baseProjectFingerprint).toBe("fingerprint-1");
    expect(proposal.v2Binding).toMatchObject({ builderAgentId: "ui-builder-agent", builderModelProfileId: "ui-builder-default", attempt: 1 });
    expect(proposal.packageChanges).toEqual([]);
    expect(proposal.commandsRequested).toEqual([]);
  });

  test("a model that declares the plan unexecutable raises the typed error", async () => {
    await expect(
      modelUIBuilderStrategy(
        { agentId: "ui-builder-agent", objective: "build", input: { evidence, projectId: "p", baseProjectFingerprint: "f" }, attempt: 1 },
        context(() => ({
          type: "success",
          output: { files: [], assumptions: [], unresolvedItems: [], unexecutableReason: "the mapped component was deleted" },
        })),
        uiBuilderAgentManifest,
      ),
    ).rejects.toThrow(/deleted/);
  });

  test("the request states the plan as binding and carries the write allow-list", async () => {
    let captured = "";
    await modelUIBuilderStrategy(
      { agentId: "ui-builder-agent", objective: "build", input: { evidence, projectId: "p", baseProjectFingerprint: "f" }, attempt: 1 },
      context((request) => {
        captured = request.messages.map((message) => message.content).join("\n");
        return { type: "success", output: { files: [{ path: DESTINATION_PATH, action: "create", content: "x", reason: "r", relatedDesignNodeIds: [] }], assumptions: [], unresolvedItems: [], unexecutableReason: null } };
      }),
      uiBuilderAgentManifest,
    );
    expect(captured).toContain("immutable");
    expect(captured).toContain("allowedWritePaths");
    expect(captured).toContain("Enter amount");
  });
});

describe("the report reads the result, and states nothing more", () => {
  test("a valid build renders its files and its checks", async () => {
    const builder = scriptedBuilder([validProposal()]);
    const result = await buildImplementation({
      blueprint: BLUEPRINT,
      map: MIXED_MAP,
      context: PROJECT,
      projectId: "project-fixture",
      baseProjectFingerprint: "fingerprint-1",
      generate: builder.generate,
      validateProposedState: async () => ({ status: "passed", diagnostics: [] }),
    });

    const report = renderBuilderReport(result, MIXED_MAP)
      .map((section) => `## ${section.title}\n${section.lines.join("\n")}`)
      .join("\n\n");

    expect(report).toContain("Reuse");
    expect(report).toContain("Extend");
    expect(report).toContain("Create");
    expect(report).toContain(`+ ${DESTINATION_PATH}`);
    expect(report).toContain(`~ ${TEXTFIELD_PATH}`);
    expect(report).toContain("✓ Map respected");
    expect(report).toContain("✓ Reachability");
    expect(report).toContain("✓ Build");
  });
});
