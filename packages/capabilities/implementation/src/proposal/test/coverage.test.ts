import { describe, expect, test } from "bun:test";
import { deriveImplementationCoveragePlan, validateImplementationCoverage } from "./coverage";
import type { ImplementationCoverageClaim, ImplementationCoveragePlanV1, ProposedFileChanges } from "@designflow/sdk";

const SPEC = {
  schemaVersion: "2", sourceIdentity: { designFile: "file" }, frames: ["iPhone 16 Pro Max - 14"],
  hierarchy: [{ id: "1026:6098", name: "iPhone 16 Pro Max - 14" }, { id: "1026:6100", name: "Add Expense Form", parentId: "1026:6098" }],
  designTokens: { colors: [], spacing: [], typography: [], radii: [], borders: [], shadows: [], referencedVariableNames: [] },
  components: [], layoutBehavior: [], responsiveAssumptions: [], assets: [], content: [], interactions: [], states: [],
  accessibilityNotes: [], ambiguities: [], agentVersion: "1",
};

const MAPPING = {
  schemaVersion: "1", tokenMappings: [], assetMappings: [], unresolved: [],
  componentMappings: [
    { designComponentId: "Primary button", projectComponentReference: "PrimaryButton", confidence: 0.95, action: "reuse", reason: "exact match" },
    { designComponentId: "Mystery", projectComponentReference: "Unknown", confidence: 0.9, action: "reuse", reason: "no source" },
    { designComponentId: "New thing", confidence: 0.2, action: "create", reason: "no match" },
  ],
};

const PROJECT = {
  schemaVersion: "1",
  project: { id: "p1", rootIdentity: "r".repeat(64), contextFingerprint: "f".repeat(64) },
  runtime: { framework: "react", language: "javascript", packageManager: "npm", monorepo: false },
  structure: { sourceRoots: ["src"], routeRoots: [], publicAssetRoots: [], aliases: {} },
  styling: { strategies: ["css-modules"], evidence: [] },
  designSystem: {
    tokenSources: [], tokens: [],
    componentSources: [{ path: "src/components/PrimaryButton.jsx", exportedNames: ["PrimaryButton"] }],
    components: [{ name: "PrimaryButton", sourcePath: "src/components/PrimaryButton.jsx", props: [], variants: [], safeToReuse: true, evidence: ["component source"] }],
  },
  conventions: { naming: [], fileLayout: [], exports: [], props: [], testing: [], accessibility: [] },
  commands: {},
  warnings: [],
};

function plan(): ImplementationCoveragePlanV1 {
  return deriveImplementationCoveragePlan(SPEC, MAPPING, PROJECT);
}

function proposal(paths: Array<{ path: string; action?: "create" | "modify" }>): ProposedFileChanges {
  return {
    schemaVersion: "1", projectId: "p1", baseProjectFingerprint: "f".repeat(64),
    files: paths.map((file) => ({ path: file.path, action: file.action ?? "create", content: "export {};\n", reason: "test", relatedDesignNodeIds: [] })),
    packageChanges: [], commandsRequested: [], assumptions: [], unresolvedItems: [],
  } as ProposedFileChanges;
}

const rootClaim = (paths: string[], supporting: string[] = []): ImplementationCoverageClaim => ({ targetId: "frame:1026:6098", mode: "proposed_change", paths, supportingPaths: supporting });
const buttonReuse = (path: string): ImplementationCoverageClaim => ({ targetId: "component:Primary button", mode: "existing_reuse", paths: [path], supportingPaths: [] });

describe("coverage plan derivation", () => {
  test("root frame is always required and mapped reuse components join with trusted paths", () => {
    const value = plan();
    expect(value.targetFrame).toEqual({ nodeId: "1026:6098", name: "iPhone 16 Pro Max - 14" });
    expect(value.requiredTargets.map((target) => target.id)).toEqual(["frame:1026:6098", "component:Primary button"]);
    expect(value.requiredTargets[1]!.mappedProjectPaths).toEqual(["src/components/PrimaryButton.jsx"]);
    expect(value.trustedReusePaths).toEqual(["src/components/PrimaryButton.jsx"]);
  });
});

describe("coverage validation", () => {
  test("a CSS-only proposal cannot cover the root frame (the MVP-4N live failure)", () => {
    expect(() =>
      validateImplementationCoverage(plan(), proposal([{ path: "src/components/NavMenu/NavMenu.module.css" }]), [
        rootClaim(["src/components/NavMenu/NavMenu.module.css"]),
        buttonReuse("src/components/PrimaryButton.jsx"),
      ]),
    ).toThrow("no executable primary path");
  });

  test("no claim for the root frame is incomplete coverage", () => {
    expect(() =>
      validateImplementationCoverage(plan(), proposal([{ path: "src/pages/AddExpensePage.jsx" }]), [buttonReuse("src/components/PrimaryButton.jsx")]),
    ).toThrow("does not cover required design target frame:1026:6098");
  });

  test("an executable page with a supporting stylesheet passes", () => {
    const result = validateImplementationCoverage(
      plan(),
      proposal([{ path: "src/pages/AddExpensePage.jsx" }, { path: "src/pages/AddExpensePage.module.css" }]),
      [rootClaim(["src/pages/AddExpensePage.jsx"], ["src/pages/AddExpensePage.module.css"]), buttonReuse("src/components/PrimaryButton.jsx")],
    );
    expect(result.status).toBe("passed");
    expect(result.satisfiedTargets.map((target) => target.targetId)).toEqual(["frame:1026:6098", "component:Primary button"]);
  });

  test("existing_reuse must reference trusted mapped paths only", () => {
    expect(() =>
      validateImplementationCoverage(plan(), proposal([{ path: "src/pages/AddExpensePage.jsx" }]), [
        rootClaim(["src/pages/AddExpensePage.jsx"]),
        buttonReuse("src/components/SomethingElse.jsx"),
      ]),
    ).toThrow("outside the trusted implementation mapping");
  });

  test("a required component target without any claim is incomplete", () => {
    expect(() =>
      validateImplementationCoverage(plan(), proposal([{ path: "src/pages/AddExpensePage.jsx" }]), [rootClaim(["src/pages/AddExpensePage.jsx"])]),
    ).toThrow("does not cover required design target component:Primary button");
  });

  test("a proposed_change claim to a file not in the proposal is invalid", () => {
    expect(() =>
      validateImplementationCoverage(plan(), proposal([{ path: "src/pages/Other.jsx" }]), [
        rootClaim(["src/pages/SomePage.jsx"]),
        buttonReuse("src/components/PrimaryButton.jsx"),
      ]),
    ).toThrow("not part of the proposal");
  });

  test("a claim for an unknown target is invalid — the model cannot define targets", () => {
    expect(() =>
      validateImplementationCoverage(plan(), proposal([{ path: "src/pages/AddExpensePage.jsx" }]), [
        rootClaim(["src/pages/AddExpensePage.jsx"]),
        buttonReuse("src/components/PrimaryButton.jsx"),
        { targetId: "frame:invented", mode: "proposed_change", paths: ["src/pages/AddExpensePage.jsx"], supportingPaths: [] },
      ]),
    ).toThrow("unknown target");
  });
});

// ── Post-release remediation: mapping/scope consistency ──

describe("trusted mapping consistency", () => {
  test("a discovered existing component is reusable exactly as the validator authorizes it", () => {
    const derived = plan();
    expect(derived.trustedReusePaths).toContain("src/components/PrimaryButton.jsx");
    const result = validateImplementationCoverage(
      derived,
      proposal([{ path: "src/app/add/GeneratedScreen.jsx" }]),
      [rootClaim(["src/app/add/GeneratedScreen.jsx"]), buttonReuse("src/components/PrimaryButton.jsx")],
    );
    expect(result.status).toBe("passed");
  });

  test("model-visible trustedReusePaths and validator-authorized reuse scope are the same set", () => {
    // The exact plan object handed to the Implementation Agent is the one the
    // validator enforces — the agent can never be invited to claim a reuse
    // path the host will reject.
    const derived = plan();
    for (const path of derived.trustedReusePaths) {
      expect(() =>
        validateImplementationCoverage(derived, proposal([{ path: "src/app/add/GeneratedScreen.jsx" }]), [
          rootClaim(["src/app/add/GeneratedScreen.jsx"]),
          { targetId: "component:Primary button", mode: "existing_reuse", paths: [path], supportingPaths: [] },
        ]),
      ).not.toThrow();
    }
  });

  test("a reuse path outside the trusted mapping is still strictly rejected", () => {
    expect(() =>
      validateImplementationCoverage(plan(), proposal([{ path: "src/app/add/GeneratedScreen.jsx" }]), [
        rootClaim(["src/app/add/GeneratedScreen.jsx"]),
        buttonReuse("src/components/NotDiscovered.tsx"),
      ]),
    ).toThrow(expect.objectContaining({ code: "ERR_PROPOSAL_COVERAGE_INVALID" }));
  });
});
