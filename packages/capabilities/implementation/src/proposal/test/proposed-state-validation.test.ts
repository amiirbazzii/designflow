import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync as realpath, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { changedExecutableFiles, isEnvironmentFailureOutput, materializeWorkspaceNodeModules, validateProposedModules } from "../../proposal/proposed-state-validation";

const BUILD = { executable: "bun", args: ["build", "./designflow-proposed-entry.js", "--outdir=dist"] };

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "designflow-proposed-fixture-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

const BASE = {
  "package.json": JSON.stringify({ name: "proposed-fixture", scripts: { build: "bun build ./designflow-proposed-entry.js --outdir=dist" } }),
  "index.html": `<!doctype html><html><body><script type="module" src="/src/main.jsx"></script></body></html>`,
  "src/main.jsx": `import App from "./App.jsx";\nexport default App;\n`,
  "src/App.jsx": `export default function App() { return null; }\n`,
  "src/components/TextField.tsx": `export const TextField = () => null;\n`,
};

function proposal(files: Array<{ path: string; action: "create" | "modify"; content: string; expectedBaseHash?: string }>) {
  return { schemaVersion: "1", projectId: "p1", baseProjectFingerprint: "f".repeat(64), files: files.map((file) => ({ ...file, reason: "test", relatedDesignNodeIds: [] })), packageChanges: [], commandsRequested: [], assumptions: [], unresolvedItems: [] };
}

const DEFAULT_IMPORT = `import TextField from "./components/TextField.tsx";\nexport default function GeneratedScreen() { return TextField; }\n`;
const NAMED_IMPORT = `import { TextField } from "./components/TextField.tsx";\nexport default function GeneratedScreen() { return TextField; }\n`;

function snapshotTree(root: string): string {
  const entries: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      try {
        entries.push(`${full}:${readFileSync(full, "utf8").length}`);
      } catch {
        walk(full);
      }
    }
  };
  walk(root);
  return entries.join("|");
}

function lingeringWorkspaces(): string[] {
  return readdirSync(tmpdir()).filter((name) => name.startsWith("designflow-proposed-state-"));
}

describe("proposed-module compile validation", () => {
  test("classifies only executable sources as module entries", () => {
    const value = proposal([
      { path: "src/GeneratedScreen.jsx", action: "create", content: "x" },
      { path: "src/GeneratedScreen.module.css", action: "create", content: ".a{}" },
      { path: "src/tokens.css", action: "create", content: ":root{}" },
      { path: "docs/readme.md", action: "create", content: "#" },
      { path: "src/util.ts", action: "create", content: "export {};" },
    ]);
    expect(changedExecutableFiles(value as never)).toEqual(["src/GeneratedScreen.jsx", "src/util.ts"]);
  });

  test("a latent default-import defect fails even though nothing imports the module", async () => {
    const root = fixture(BASE);
    const before = snapshotTree(root);
    try {
      const result = await validateProposedModules(root, proposal([{ path: "src/GeneratedScreen.jsx", action: "create", content: DEFAULT_IMPORT }]), { buildCommand: BUILD });
      expect(result.status).toBe("failed");
      expect(result.validatedFiles).toEqual(["src/GeneratedScreen.jsx"]);
      expect(result.diagnostics.map((d) => d.message).join("\n")).toContain('No matching export');
      expect(snapshotTree(root)).toBe(before);
      expect(lingeringWorkspaces()).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the corrected named import passes while still unmounted", async () => {
    const root = fixture(BASE);
    try {
      const result = await validateProposedModules(root, proposal([{ path: "src/GeneratedScreen.jsx", action: "create", content: NAMED_IMPORT }]), { buildCommand: BUILD });
      expect(result.status).toBe("passed");
      expect(result.diagnostics).toEqual([]);
      expect(lingeringWorkspaces()).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("one invalid module invalidates a multi-module proposal and is identified", async () => {
    const root = fixture(BASE);
    try {
      const result = await validateProposedModules(root, proposal([
        { path: "src/Valid.jsx", action: "create", content: NAMED_IMPORT },
        { path: "src/Broken.jsx", action: "create", content: DEFAULT_IMPORT },
      ]), { buildCommand: BUILD });
      expect(result.status).toBe("failed");
      expect(result.diagnostics.some((d) => d.file === "src/Broken.jsx" || d.message.includes("Broken.jsx"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("css module dependencies resolve without becoming entries themselves", async () => {
    const root = fixture(BASE);
    try {
      const result = await validateProposedModules(root, proposal([
        { path: "src/Card.jsx", action: "create", content: `import styles from "./Card.module.css";\nexport default () => styles;\n` },
        { path: "src/Card.module.css", action: "create", content: ".card { color: red; }\n" },
        { path: "src/tokens.css", action: "create", content: ":root { --ink: #111; }\n" },
      ]), { buildCommand: BUILD });
      expect(result.status).toBe("passed");
      expect(result.validatedFiles).toEqual(["src/Card.jsx"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("validation is hash-bound to the exact proposal content", async () => {
    const root = fixture(BASE);
    try {
      const a = await validateProposedModules(root, proposal([{ path: "src/GeneratedScreen.jsx", action: "create", content: NAMED_IMPORT }]), { buildCommand: BUILD });
      const b = await validateProposedModules(root, proposal([{ path: "src/GeneratedScreen.jsx", action: "create", content: DEFAULT_IMPORT }]), { buildCommand: BUILD });
      const again = await validateProposedModules(root, proposal([{ path: "src/GeneratedScreen.jsx", action: "create", content: NAMED_IMPORT }]), { buildCommand: BUILD });
      expect(a.proposalHash).not.toBe(b.proposalHash);
      expect(a.proposalHash).toBe(again.proposalHash);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a proposal with no executable modules passes without a workspace", async () => {
    const root = fixture(BASE);
    try {
      const result = await validateProposedModules(root, proposal([{ path: "src/only.css", action: "create", content: ".a{}" }]), { buildCommand: BUILD });
      expect(result.status).toBe("passed");
      expect(result.validatedFiles).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a missing build command reports unavailable instead of guessing", async () => {
    const root = fixture(BASE);
    try {
      const result = await validateProposedModules(root, proposal([{ path: "src/GeneratedScreen.jsx", action: "create", content: NAMED_IMPORT }]));
      expect(result.status).toBe("unavailable");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("cancellation cleans up the workspace and throws a typed error", async () => {
    const root = fixture(BASE);
    const controller = new AbortController();
    controller.abort();
    try {
      await expect(validateProposedModules(root, proposal([{ path: "src/GeneratedScreen.jsx", action: "create", content: NAMED_IMPORT }]), { buildCommand: BUILD, signal: controller.signal })).rejects.toThrow("cancelled");
      expect(lingeringWorkspaces()).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("compile-valid NavigationMenu proposal can still fail the proposed-state runtime gate", async () => {
    const root = fixture(BASE);
    try {
      const result = await validateProposedModules(
        root,
        proposal([{ path: "src/AddExpensePage.jsx", action: "create", content: `export default function AddExpensePage() { return NavigationMenu(); }\nfunction NavigationMenu() { throw new Error("NavigationMenu missing required items prop"); }\n` }]),
        {
          buildCommand: BUILD,
          postBuild: async (workspace) => {
            expect(readFileSync(join(workspace, "src/AddExpensePage.jsx"), "utf8")).toContain("NavigationMenu");
            return { status: "failed", diagnostics: [{ message: "pageerror: NavigationMenu missing required items prop" }] };
          },
        },
      );
      expect(result.status).toBe("passed");
      expect(result.postBuild?.status).toBe("failed");
      expect(result.postBuild?.diagnostics[0]?.message).toContain("NavigationMenu");
      expect(lingeringWorkspaces()).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("compile failure short-circuits the proposed-state runtime gate", async () => {
    const root = fixture(BASE);
    let runtimeStarted = false;
    try {
      const result = await validateProposedModules(
        root,
        proposal([{ path: "src/Broken.jsx", action: "create", content: `import Missing from "./does-not-exist";\nexport default Missing;\n` }]),
        {
          buildCommand: BUILD,
          postBuild: async () => {
            runtimeStarted = true;
            return { status: "passed", diagnostics: [] };
          },
        },
      );
      expect(result.status).toBe("failed");
      expect(result.postBuild).toBeUndefined();
      expect(runtimeStarted).toBe(false);
      expect(lingeringWorkspaces()).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── Post-release remediation: workspace containment + environment classification ──

describe("proposed-state workspace containment", () => {
  test("node_modules is materialized with its real path INSIDE the workspace", async () => {
    const root = fixture({ ...BASE, "node_modules/leftlib/index.js": "module.exports = 1;\n", "node_modules/leftlib/package.json": JSON.stringify({ name: "leftlib", main: "index.js" }) });
    const workspace = mkdtempSync(join(tmpdir(), "designflow-containment-"));
    try {
      const mode = materializeWorkspaceNodeModules(root, realpath(workspace));
      const containedRealpath = realpath(join(workspace, "node_modules"));
      if (mode === "cloned") {
        // Realpath containment is exactly what stops Next/Turbopack file
        // tracing from climbing above the workspace into /private/var/Users.
        expect(containedRealpath.startsWith(realpath(workspace))).toBe(true);
        expect(readFileSync(join(workspace, "node_modules", "leftlib", "index.js"), "utf8")).toContain("module.exports");
      } else {
        expect(mode).toBe("symlinked");
      }
    } finally {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a build failing with an errno OUTSIDE the workspace is a workspace failure, never a compile failure", async () => {
    const root = fixture({
      ...BASE,
      "package.json": JSON.stringify({ name: "env-fail", scripts: { build: "node fail-env.cjs" } }),
      "fail-env.cjs": "console.error(\"Error: EACCES: permission denied, mkdir '/private/var/Users'\"); process.exit(1);\n",
    });
    try {
      await expect(
        validateProposedModules(root, proposal([{ path: "src/New.jsx", action: "create", content: "export default () => null;\n" }]), { buildCommand: { executable: "node", args: ["fail-env.cjs"] } }),
      ).rejects.toMatchObject({ code: "ERR_PROPOSED_STATE_WORKSPACE_FAILED" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a genuine strict TypeScript diagnostic remains a compile failure with the exact message", async () => {
    const root = fixture({
      ...BASE,
      "package.json": JSON.stringify({ name: "ts-fail", scripts: { build: "node fail-ts.cjs" } }),
      "fail-ts.cjs": "console.error(\"Type error: Binding element 'date' implicitly has an 'any' type.\"); process.exit(1);\n",
    });
    try {
      const result = await validateProposedModules(root, proposal([{ path: "src/New.jsx", action: "create", content: "export default () => null;\n" }]), { buildCommand: { executable: "node", args: ["fail-ts.cjs"] } });
      expect(result.status).toBe("failed");
      expect(result.diagnostics.map((d) => d.message).join("\n")).toContain("Binding element 'date' implicitly has an 'any' type.");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("environment classification requires an escape — errno on a workspace-internal path stays a compile failure", () => {
    expect(isEnvironmentFailureOutput("Error: EACCES: permission denied, mkdir '/private/var/Users'", "/private/var/folders/x/T/ws")).toBe(true);
    expect(isEnvironmentFailureOutput("Symlink [project]/node_modules is invalid, it points out of the filesystem root", "/ws")).toBe(true);
    expect(isEnvironmentFailureOutput("Error: EACCES: permission denied, open '/private/var/folders/x/T/ws/dist/a.js'", "/private/var/folders/x/T/ws")).toBe(false);
    expect(isEnvironmentFailureOutput("Type error: Binding element 'date' implicitly has an 'any' type.", "/ws")).toBe(false);
  });

  test("the original project is untouched by a validation that fails in the workspace", async () => {
    const root = fixture({
      ...BASE,
      "package.json": JSON.stringify({ name: "untouched", scripts: { build: "node fail-env.cjs" } }),
      "fail-env.cjs": "console.error(\"Error: EACCES: permission denied, mkdir '/private/var/Users'\"); process.exit(1);\n",
    });
    const before = snapshotTree(root);
    try {
      await validateProposedModules(root, proposal([{ path: "src/New.jsx", action: "create", content: "export default () => null;\n" }]), { buildCommand: { executable: "node", args: ["fail-env.cjs"] } }).catch(() => undefined);
      expect(snapshotTree(root)).toBe(before);
      expect(lingeringWorkspaces()).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
