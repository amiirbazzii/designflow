import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createProjectSnapshot } from "@designflow/capability-implementation";
import { correctionContextV1Schema, MAX_CORRECTION_COMPOSITION_FILES, type CorrectionContextV1 } from "@designflow/sdk";
import { analyzeRenderReachability, deriveCompositionScope } from "./composition-scope";
import { readBoundedExcerpt, sha256, validateCorrectionAgentOutput } from "./feedback-loop-utils";
import { type FeedbackLoopWorkflowInput } from "./feedback-loop-types";

const HASH = "a".repeat(64);

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "designflow-composition-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

const REACT_FIXTURE = {
  "index.html": `<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>`,
  "src/main.jsx": `import React from "react";\nimport { createRoot } from "react-dom/client";\nimport "./index.css";\nimport App from "./App";\ncreateRoot(document.getElementById("root")).render(<App />);\n`,
  "src/App.jsx": `export default function App() { return <main>fixture</main>; }\n`,
  "src/index.css": `:root { --ink: #111; }\n`,
  "src/components/GeneratedScreen.jsx": `export default function GeneratedScreen() { return <section />; }\n`,
  "scripts/release.mjs": `export const release = true;\n`,
  "README.md": `# fixture\n`,
};

describe("deterministic composition scope derivation", () => {
  test("derives the entry and root component with explicit provenance", () => {
    const root = fixture(REACT_FIXTURE);
    try {
      const scope = deriveCompositionScope(root);
      expect(scope.map((entry) => entry.path)).toEqual(["src/main.jsx", "src/App.jsx"]);
      expect(scope[0]).toEqual({ path: "src/main.jsx", reason: "preview entry module referenced by index.html", source: "deterministic-project-inspection" });
      expect(scope[1]!.reason).toBe("root component imported by application entry src/main.jsx");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("never includes unrelated repository files or style imports", () => {
    const root = fixture(REACT_FIXTURE);
    try {
      const paths = deriveCompositionScope(root).map((entry) => entry.path);
      expect(paths).not.toContain("scripts/release.mjs");
      expect(paths).not.toContain("README.md");
      expect(paths).not.toContain("src/index.css");
      expect(paths).not.toContain("src/components/GeneratedScreen.jsx");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("fails closed when the render path cannot be resolved deterministically", () => {
    const noHtml = fixture({ "src/main.jsx": REACT_FIXTURE["src/main.jsx"] });
    const noModule = fixture({ ...REACT_FIXTURE, "index.html": `<script src="/src/main.jsx"></script>` });
    const remote = fixture({ ...REACT_FIXTURE, "index.html": `<script type="module" src="https://cdn.example/app.js"></script>` });
    try {
      expect(deriveCompositionScope(noHtml)).toEqual([]);
      expect(deriveCompositionScope(noModule)).toEqual([]);
      expect(deriveCompositionScope(remote)).toEqual([]);
    } finally {
      for (const root of [noHtml, noModule, remote]) rmSync(root, { recursive: true, force: true });
    }
  });

  test("respects the fixed bound using entry-then-import-order precedence", () => {
    const many = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`src/Part${index}.jsx`, `export default () => <p>${index}</p>;\n`]));
    const imports = Array.from({ length: 12 }, (_, index) => `import Part${index} from "./Part${index}";`).join("\n");
    const root = fixture({ ...many, "index.html": REACT_FIXTURE["index.html"], "src/main.jsx": `${imports}\nexport {};\n` });
    try {
      const scope = deriveCompositionScope(root);
      expect(scope.length).toBe(MAX_CORRECTION_COMPOSITION_FILES);
      expect(scope[0]!.path).toBe("src/main.jsx");
      expect(scope[1]!.path).toBe("src/Part0.jsx");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("skips symlinked composition candidates", () => {
    const root = fixture(REACT_FIXTURE);
    try {
      rmSync(join(root, "src/App.jsx"));
      writeFileSync(join(root, "real-app.jsx"), "export default () => null;\n");
      symlinkSync(join(root, "real-app.jsx"), join(root, "src/App.jsx"));
      const paths = deriveCompositionScope(root).map((entry) => entry.path);
      expect(paths).not.toContain("src/App.jsx");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("correction validation with composition-authorized scope", () => {
  const input = { iterationPolicy: { maxIterations: 1, maxFilesPerIteration: 5, maxChangedBytesPerIteration: 200_000, maxDependenciesPerIteration: 0, maxFindingsPerIteration: 5, modelInterpretedAllowed: false, modelConfidenceThreshold: 0.9, requireApprovalEveryIteration: true, continueAfterImprovement: false } } as FeedbackLoopWorkflowInput;

  function contextFor(root: string): CorrectionContextV1 {
    const excerpts = ["src/components/GeneratedScreen.jsx", "src/main.jsx", "src/App.jsx"].map((path) => readBoundedExcerpt(root, path));
    return correctionContextV1Schema.parse({
      schemaVersion: "1", iterationNumber: 1,
      selectedFindings: [{ findingId: "f-root", classification: "deterministic", affectedFiles: excerpts.map((excerpt) => excerpt.path), evidenceReferences: ["ev-1"] }],
      visualFindings: [], evidenceReferences: [{ artifactId: "ev-1", artifactHash: HASH, version: "1" }],
      currentImplementationExcerpts: excerpts,
      relevantDesignTokens: [], relevantComponents: [],
      allowedFileScope: excerpts.map((excerpt) => excerpt.path),
      compositionAuthorizedFiles: [
        { path: "src/main.jsx", reason: "preview entry module referenced by index.html", source: "deterministic-project-inspection" },
        { path: "src/App.jsx", reason: "root component imported by application entry src/main.jsx", source: "deterministic-project-inspection" },
      ],
      forbiddenPaths: [], projectCommands: [], currentProjectFingerprint: HASH, currentImplementationHash: HASH,
      previousIterationSummaries: [], designSystemMapping: { artifactId: "mapping", artifactHash: HASH, version: "1" }, evidenceOnly: true,
    });
  }

  function outputFor(context: CorrectionContextV1, path: string, baseFileHash: string) {
    const proposedContent = `import GeneratedScreen from "./components/GeneratedScreen";\nexport default function App() { return <GeneratedScreen />; }\n`;
    return {
      schemaVersion: "1",
      plan: { schemaVersion: "1", iterationNumber: 1, objective: "Mount the generated screen at the application root.", selectedFindingIds: ["f-root"], findingToChangeMapping: [{ findingId: "f-root", changeIndexes: [0], expectedOutcome: "The generated screen renders.", evidenceIds: ["ev-1"] }], filesExpectedToChange: [path], filesExpectedToRemainUnchanged: [], dependencyChanges: [], validationCommands: [], visualRevalidationRequirements: { required: true, viewports: ["desktop"], invalidateOldScreenshots: true }, risks: ["Composition change."], rollbackStatement: "Restore the correction snapshot.", confidence: 0.9, limitations: [], agent: { id: "visual-correction-agent", version: "0.1.0", modelProfileId: "visual-correction-default" }, evidenceReferences: ["ev-1"] },
      changes: [{ schemaVersion: "1", operation: "modify", relativePath: path, baseFileHash, proposedContentHash: sha256(proposedContent), proposedContent, reason: "Mount generated UI at the root.", findingIds: ["f-root"], evidenceIds: ["ev-1"], expectedMeasurableOutcome: { expected: "generated UI rendered" }, designSystemReferences: [], dependencyChangeRequired: false }],
      traceIds: [],
    };
  }

  test("allows a modification to the authorized root composition file", () => {
    const root = fixture(REACT_FIXTURE);
    try {
      const context = contextFor(root);
      const base = context.currentImplementationExcerpts.find((excerpt) => excerpt.path === "src/App.jsx")!.hash;
      expect(() => validateCorrectionAgentOutput(outputFor(context, "src/App.jsx", base), context, input)).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects a proposal that targets a file outside the allowed scope", () => {
    const root = fixture(REACT_FIXTURE);
    try {
      const context = contextFor(root);
      expect(() => validateCorrectionAgentOutput(outputFor(context, "scripts/release.mjs", HASH), context, input)).toThrow("widens the approved file scope");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects a stale base hash for an authorized composition file", () => {
    const root = fixture(REACT_FIXTURE);
    try {
      const context = contextFor(root);
      expect(() => validateCorrectionAgentOutput(outputFor(context, "src/App.jsx", "b".repeat(64)), context, input)).toThrow("stale or has an invalid content hash");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("composition files and dirty-target safety", () => {
  function git(root: string, ...args: string[]): void {
    execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
  }

  function repositoryFixture(): { root: string; state: string } {
    const root = fixture(REACT_FIXTURE);
    git(root, "init", "-q");
    git(root, "config", "user.email", "designflow-tests@example.invalid");
    git(root, "config", "user.name", "DesignFlow tests");
    git(root, "add", ".");
    git(root, "commit", "-qm", "fixture");
    return { root, state: mkdtempSync(join(tmpdir(), "designflow-composition-state-")) };
  }

  const proposal = (root: string, paths: string[]) => ({
    schemaVersion: "1" as const, projectId: "p-1", baseProjectFingerprint: HASH,
    files: paths.map((path) => ({ path, action: "modify" as const, content: "next\n", expectedBaseHash: readBoundedExcerpt(root, path).hash, reason: "test" })),
    packageChanges: [], commandsRequested: [], assumptions: [], unresolvedItems: [],
  });

  test("a clean authorized composition file may be snapshotted without an exemption", async () => {
    const { root, state } = repositoryFixture();
    try {
      writeFileSync(join(root, "src/components/GeneratedScreen.jsx"), "export default () => <ul />;\n");
      await expect(createProjectSnapshot("p-1", root, proposal(root, ["src/App.jsx", "src/components/GeneratedScreen.jsx"]), HASH, state, { exemptDirtyTargets: ["src/components/GeneratedScreen.jsx"] })).resolves.toBeDefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(state, { recursive: true, force: true });
    }
  });

  test("a dirty composition file without parent-applied provenance fails closed", async () => {
    const { root, state } = repositoryFixture();
    try {
      writeFileSync(join(root, "src/App.jsx"), "export default () => <p>local user edit</p>;\n");
      await expect(createProjectSnapshot("p-1", root, proposal(root, ["src/App.jsx"]), HASH, state, { exemptDirtyTargets: [] })).rejects.toThrow("uncommitted Git changes");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(state, { recursive: true, force: true });
    }
  });
});

describe("render reachability analysis", () => {
  test("an unmounted generated screen is unreachable while App stays reachable", () => {
    const root = fixture(REACT_FIXTURE);
    try {
      const result = analyzeRenderReachability(root, ["src/App.jsx", "src/components/GeneratedScreen.jsx"]);
      expect(result.previewEntry).toBe("src/main.jsx");
      expect(result.reachableChangedFiles).toEqual(["src/App.jsx"]);
      expect(result.unreachableChangedFiles).toEqual(["src/components/GeneratedScreen.jsx"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a transitively mounted module is reachable", () => {
    const root = fixture({ ...REACT_FIXTURE, "src/App.jsx": `import GeneratedScreen from "./components/GeneratedScreen.jsx";\nexport default function App() { return <GeneratedScreen />; }\n` });
    try {
      const result = analyzeRenderReachability(root, ["src/components/GeneratedScreen.jsx"]);
      expect(result.reachableChangedFiles).toEqual(["src/components/GeneratedScreen.jsx"]);
      expect(result.unreachableChangedFiles).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("with no resolvable preview entry everything is honestly unreachable", () => {
    const root = fixture({ "src/main.jsx": REACT_FIXTURE["src/main.jsx"] });
    try {
      const result = analyzeRenderReachability(root, ["src/main.jsx"]);
      expect(result.previewEntry).toBeUndefined();
      expect(result.unreachableChangedFiles).toEqual(["src/main.jsx"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
