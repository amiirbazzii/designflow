// packages/agents/src/catalog/specialized-agents.test.ts
import { describe, expect, test } from "bun:test";
import {
  designSpecificationSchema,
  figmaSourceSnapshotSchema,
  generatedImplementationSchema,
  projectImplementationContextSchema,
  visualValidationReportSchema,
  type SpecializedAgentContext,
} from "@designflow/sdk";

import {
  deterministicFigmaSpecificationStrategy,
  figmaSpecificationAgentManifest,
} from "./figma-specification-agent";
import {
  deterministicImplementationStrategy,
  implementationAgentManifest,
} from "./implementation-agent";
import {
  deterministicVisualValidationStrategy,
  visualValidationAgentManifest,
} from "./visual-validation-agent";

const EMPTY_CONTEXT: SpecializedAgentContext = {
  tools: { call: async () => { throw new Error("no tools in this test"); } },
  model: { generate: async () => { throw new Error("no model in this test"); } },
  metadata: {},
  signal: new AbortController().signal,
  logger: { info() {}, warn() {}, error() {}, debug() {} },
};

const SNAPSHOT = figmaSourceSnapshotSchema.parse({
  source: { designFile: "homepage.fig", nodeIds: ["node-0"], frames: ["brand/Header"] },
  nodes: [{ id: "node-0", name: "Header", type: "FRAME" }],
  variables: [{ name: "color.brand", value: "#111827" }],
  assets: [],
});

describe("Figma Specification Agent", () => {
  test("its deterministic strategy always produces a schema-valid design specification", async () => {
    const spec = await deterministicFigmaSpecificationStrategy(
      { agentId: "figma-specification-agent", objective: "test", input: { figmaSnapshot: SNAPSHOT }, attempt: 1 },
      EMPTY_CONTEXT,
      figmaSpecificationAgentManifest,
    );

    expect(() => designSpecificationSchema.parse(spec)).not.toThrow();
    expect(spec.agentVersion).toBe(figmaSpecificationAgentManifest.version);
  });

  test("it may not use any tool or model — its manifest grants none", () => {
    expect(figmaSpecificationAgentManifest.allowedTools).toEqual([]);
  });

  test("a Desktop-MCP-shaped rich snapshot yields real hierarchy, text, and style facts in the specification", async () => {
    const richSnapshot = figmaSourceSnapshotSchema.parse({
      source: {
        designFile: "https://www.figma.com/design/abc123/ScreenA?node-id=10-1",
        nodeIds: ["10:1"],
        frames: [],
        resolvedFrames: [{ id: "10:1", name: "Screen A", path: ["Screen A"] }],
      },
      nodes: [
        {
          id: "10:1",
          name: "Screen A",
          type: "FRAME",
          childIds: ["10:2", "10:8"],
          absoluteBoundingBox: { x: 0, y: 0, width: 440, height: 1092 },
          fills: [{ type: "SOLID", color: "white" }],
        },
        {
          id: "10:2",
          name: "Header",
          type: "FRAME",
          parentId: "10:1",
          childIds: ["10:4"],
          absoluteBoundingBox: { x: 0, y: 0, width: 440, height: 64 },
          layoutMode: "HORIZONTAL",
          itemSpacing: 8,
          cornerRadius: 16,
          fills: [{ type: "SOLID", color: "#f9f9f9" }],
        },
        {
          id: "10:4",
          name: "Title",
          type: "TEXT",
          parentId: "10:2",
          characters: "Add Transaction",
          fills: [{ type: "SOLID", color: "black" }],
          properties: { typography: { fontFamily: "Poppins", fontStyle: "Bold", fontSize: 20 } },
        },
        {
          id: "10:8",
          name: "Nav",
          type: "INSTANCE",
          parentId: "10:1",
          absoluteBoundingBox: { x: 0, y: 1020, width: 440, height: 72 },
        },
      ],
      variables: [{ name: "Stroke/Neutral/stroke", value: "#00000005", type: "COLOR" }],
      components: [{ id: "10:8", name: "Nav" }],
      assets: [],
    });

    const spec = await deterministicFigmaSpecificationStrategy(
      { agentId: "figma-specification-agent", objective: "test", input: { figmaSnapshot: richSnapshot }, attempt: 1 },
      EMPTY_CONTEXT,
      figmaSpecificationAgentManifest,
    );

    expect(() => designSpecificationSchema.parse(spec)).not.toThrow();
    expect(spec.hierarchy.map((entry) => entry.id)).toEqual(["10:1", "10:2", "10:4", "10:8"]);
    expect(spec.hierarchy.find((entry) => entry.id === "10:4")?.parentId).toBe("10:2");
    expect(spec.content).toContain("Add Transaction");
    expect(spec.designTokens.spacing).toContain("space.8");
    expect(spec.designTokens.radii).toContain("radius.16");
    expect(spec.components.length).toBeGreaterThan(0);
  });
});

describe("Implementation Agent", () => {
  const SPEC = designSpecificationSchema.parse({
    sourceIdentity: { designFile: "homepage.fig" },
    frames: ["brand/Header"],
    hierarchy: [{ id: "node-0", name: "Header" }],
    designTokens: { colors: ["color.brand"], spacing: ["space.sm"], typography: ["type.body"] },
    components: [{ name: "Header", role: "FRAME" }],
    layoutBehavior: [],
    responsiveAssumptions: [],
    assets: [],
    interactions: [],
    accessibilityNotes: [],
    ambiguities: [],
    agentVersion: "0.1.0",
  });

  const PROJECT_CONTEXT = projectImplementationContextSchema.parse({
    projectRootIdentity: "project-fixture",
    framework: "react",
    sourceRoot: "src/components",
    stylingStrategy: "css-modules",
    contextFingerprint: "fixture-v1",
  });

  test("its deterministic strategy always produces a schema-valid generated implementation", async () => {
    const implementation = await deterministicImplementationStrategy(
      {
        agentId: "implementation-agent",
        objective: "test",
        input: { designSpecification: SPEC, projectContext: PROJECT_CONTEXT },
        attempt: 1,
      },
      EMPTY_CONTEXT,
      implementationAgentManifest,
    );

    expect(() => generatedImplementationSchema.parse(implementation)).not.toThrow();
    expect(implementation.files).toHaveLength(1);
    expect(implementation.files[0]?.content).not.toContain("return null");
  });

  test("reuses an existing project component instead of proposing a new file for it", async () => {
    const implementation = await deterministicImplementationStrategy(
      {
        agentId: "implementation-agent",
        objective: "test",
        input: {
          designSpecification: SPEC,
          projectContext: {
            ...PROJECT_CONTEXT,
            existingComponentReferences: ["Header"],
          },
        },
        attempt: 1,
      },
      EMPTY_CONTEXT,
      implementationAgentManifest,
    );

    expect(implementation.files).toHaveLength(0);
  });
});

describe("Visual Validation Agent", () => {
  const IMPLEMENTATION = generatedImplementationSchema.parse({
    files: [{ path: "src/Header.tsx", action: "create", content: "export function Header() {}", reason: "x" }],
    assumptions: [],
    unresolvedItems: [],
    implementationVersion: "0.1.0",
  });

  test("its deterministic strategy always produces a schema-valid validation report", async () => {
    const report = await deterministicVisualValidationStrategy(
      {
        agentId: "visual-validation-agent",
        objective: "test",
        input: { generatedImplementation: IMPLEMENTATION, threshold: 0.8 },
        attempt: 1,
      },
      EMPTY_CONTEXT,
      visualValidationAgentManifest,
    );

    expect(() => visualValidationReportSchema.parse(report)).not.toThrow();
    expect(report.passed).toBe(true);
  });

  test("an empty proposed file lowers the score and is reported as a discrepancy", async () => {
    const withEmptyFile = generatedImplementationSchema.parse({
      files: [{ path: "src/Header.tsx", action: "create", content: "", reason: "x" }],
      assumptions: [],
      unresolvedItems: [],
      implementationVersion: "0.1.0",
    });

    const report = await deterministicVisualValidationStrategy(
      {
        agentId: "visual-validation-agent",
        objective: "test",
        input: { generatedImplementation: withEmptyFile, threshold: 0.8 },
        attempt: 1,
      },
      EMPTY_CONTEXT,
      visualValidationAgentManifest,
    );

    expect(report.passed).toBe(false);
    expect(report.discrepancies).toHaveLength(1);
  });
});
