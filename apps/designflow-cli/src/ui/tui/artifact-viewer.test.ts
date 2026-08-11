import { describe, expect, test } from "bun:test";
import type { ArtifactDetail } from "@designflow/product";
import type { OutputView } from "./model";
import { buildArtifactViewerDocument } from "./artifact-viewer";

function output(viewerType: OutputView["viewerType"]): OutputView {
  const summary = {
    artifactId: `${viewerType}-artifact`,
    name: viewerType,
    type: `designflow.${viewerType}`,
    status: "created" as const,
    dependencies: [],
  };
  return {
    id: summary.artifactId,
    label: viewerType,
    kind: viewerType,
    stage: "Test stage",
    viewerType,
    status: "available",
    artifactRef: { artifactId: summary.artifactId, type: summary.type },
    artifactSummary: summary,
  };
}

function detail(item: OutputView, payload: unknown): ArtifactDetail {
  return { summary: item.artifactSummary!, payload };
}

describe("DesignFlow artifact viewers", () => {
  test("renders the actual specification sections and masks inline secrets", () => {
    const item = output("specification");
    const document = buildArtifactViewerDocument(item, detail(item, {
      schemaVersion: "2",
      sourceIdentity: { designFile: "Spendly", fileKey: "file-1" },
      frames: ["Add Transaction"],
      hierarchy: [{ id: "1", name: "Header" }],
      designTokens: { colors: ["#fff"], spacing: [], typography: [], radii: [], borders: [], shadows: [], referencedVariableNames: [] },
      components: [{ name: "Button", role: "action", sourceNodeIds: ["1"], variants: [], requiredAssets: [], implementationNotes: [] }],
      layoutBehavior: ["Two-column form"],
      responsiveAssumptions: [],
      assets: [],
      content: ["Use bearer secret-value"],
      interactions: [],
      states: [],
      accessibilityNotes: ["Keyboard accessible"],
      ambiguities: [],
      agentVersion: "0.1.0",
    }));

    const text = document.lines.map((line) => line.text).join("\n");
    expect(text).toContain("Source");
    expect(text).toContain("Components");
    expect(text).toContain("Button");
    expect(text).toContain("[redacted]");
    expect(text).not.toContain("secret-value");
  });

  test("renders project analysis and component mapping from bounded facts", () => {
    const project = output("project-analysis");
    const projectDocument = buildArtifactViewerDocument(project, detail(project, {
      schemaVersion: "1",
      project: { id: "p", rootIdentity: "root", contextFingerprint: "fp" },
      runtime: { framework: "Next.js", language: "typescript", packageManager: "bun", monorepo: false },
      structure: { sourceRoots: ["src"], routeRoots: ["/add"], publicAssetRoots: [], aliases: {} },
      styling: { strategies: ["CSS modules"], evidence: [] },
      designSystem: { tokenSources: [], tokens: [], componentSources: [{ path: "src/Button.tsx" }], components: [{ name: "Button", sourcePath: "src/Button.tsx", props: [], variants: [], safeToReuse: true, evidence: [] }] },
      conventions: { naming: [], fileLayout: [], exports: [], props: [], testing: [], accessibility: [] },
      commands: {},
      warnings: [],
    }));
    expect(projectDocument.lines.map((line) => line.text).join("\n")).toContain("Next.js");

    const mapping = output("component-mapping");
    const mappingDocument = buildArtifactViewerDocument(mapping, detail(mapping, {
      schemaVersion: "1",
      tokenMappings: [],
      componentMappings: [{ designComponentId: "Button", projectComponentReference: "src/Button.tsx", confidence: 0.98, action: "reuse", reason: "Matching component" }],
      assetMappings: [],
      unresolved: [],
    }));
    expect(mappingDocument.lines.map((line) => line.text).join("\n")).toContain("Button → src/Button.tsx");
  });

  test("renders proposal, validation, visual, and correction summaries", () => {
    const proposal = output("proposal");
    expect(buildArtifactViewerDocument(proposal, detail(proposal, {
      schemaVersion: "1", projectId: "p", baseProjectFingerprint: "fp",
      files: [{ path: "src/page.tsx", action: "modify", reason: "Update page", relatedDesignNodeIds: [] }],
      packageChanges: [], commandsRequested: [], assumptions: [], unresolvedItems: [],
    })).lines.map((line) => line.text).join("\n")).toContain("Modify src/page.tsx");

    const validation = output("validation");
    expect(buildArtifactViewerDocument(validation, detail(validation, { schemaVersion: "1", projectId: "p", proposalArtifactId: "proposal", applicationArtifactId: "application", passed: true, rollbackTriggered: false, checks: [{ name: "build", status: "passed", required: true, summary: "Build passed" }], warnings: [] })).lines.map((line) => line.text).join("\n")).toContain("Build passed");

    const visual = output("visual-validation");
    expect(buildArtifactViewerDocument(visual, detail(visual, { overallStatus: "pass", comparisonMode: "real-reference", confidence: 0.9 })).lines.map((line) => line.text).join("\n")).toContain("pass");

    const correction = output("correction");
    expect(buildArtifactViewerDocument(correction, detail(correction, { finalStatus: "stopped", stopReason: "no_improvement", iterationLimit: 1, totalFilesChanged: 0 })).lines.map((line) => line.text).join("\n")).toContain("no improvement");
  });

  test("unknown and unavailable artifacts use safe bounded fallback", () => {
    const unknown = output("unknown");
    const fallback = buildArtifactViewerDocument(unknown, detail(unknown, { password: "do-not-show", prompt: "hidden" }));
    expect(fallback.lines.map((line) => line.text).join("\n")).toContain("dedicated viewer");
    expect(fallback.lines.map((line) => line.text).join("\n")).not.toContain("do-not-show");

    const unavailable = buildArtifactViewerDocument(unknown, undefined);
    expect(unavailable.unavailable).toBe(true);
    expect(unavailable.lines.map((line) => line.text).join("\n")).toContain("workflow was not changed");
  });
});
