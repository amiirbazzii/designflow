import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { changedExecutableFiles, validateProposedModules } from "./proposed-state-validation";

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
});
