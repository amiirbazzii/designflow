import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { inspectRegisteredProject } from "./inspection";
import { mapDesignSystem } from "./mapping";
import { validateProposedFileChanges, projectFileHash } from "./proposal";
import { applyProjectFileChanges, rollbackProjectSnapshot, projectRootIdentity } from "./application";
import { acquireProjectWriteLock } from "./project-write-lock";
import { createApprovalBinding, verifyApproval } from "./approval";
import { validateProject } from "./validation";

async function fixture(): Promise<string> { const root = await mkdtemp(join(tmpdir(), "designflow-stage4-")); await mkdir(join(root, "src/components"), { recursive: true }); await writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture", dependencies: { react: "18.0.0" }, scripts: { typecheck: "bun --version", build: "bun --version" } })); await writeFile(join(root, "src/components/Button.tsx"), "export function Button(props: {label: string}) { return <button>{props.label}</button> }\n"); await writeFile(join(root, "src/tokens.css"), ":root { --color-brand: #123456; --space-md: 16px; }\n"); return root; }
const spec = { schemaVersion: "2", sourceIdentity: { designFile: "file" }, frames: ["Home"], hierarchy: [{ id: "node-1", name: "Button" }], designTokens: { colors: ["color-brand"], spacing: [], typography: [], radii: [], borders: [], shadows: [], referencedVariableNames: [] }, components: [{ name: "Button", role: "button", sourceNodeIds: ["node-1"], variants: [], requiredAssets: [], implementationNotes: [] }], layoutBehavior: [], responsiveAssumptions: [], assets: [], content: [], interactions: [], states: [], accessibilityNotes: ["name button"], ambiguities: [], agentVersion: "1" };

describe("Stage 4 implementation capability", () => {
  test("inspects a registered project deterministically and excludes secrets", async () => { const root = await fixture(); await writeFile(join(root, ".env"), "TOKEN=secret\n"); const project = inspectRegisteredProject({ id: "p1", name: "Fixture", rootPath: root }); expect(project.project.id).toBe("p1"); expect(project.runtime.framework).toBe("react"); expect(project.designSystem.tokens.map((token) => token.reference)).toContain("var(--color-brand)"); await rm(root, { recursive: true, force: true }); });
  test("maps exact components and tokens, with no fabricated reuse", async () => { const root = await fixture(); const context = inspectRegisteredProject({ id: "p1", name: "Fixture", rootPath: root }); const mapping = mapDesignSystem(spec, context); expect(mapping.componentMappings[0]?.action).toBe("reuse"); expect(mapping.tokenMappings[0]?.action).toBe("reuse"); await rm(root, { recursive: true, force: true }); });
  test("rejects traversal and modifications without a base hash", async () => { const root = await fixture(); expect(() => validateProposedFileChanges({ schemaVersion: "1", projectId: "p1", baseProjectFingerprint: "fp", files: [{ path: "../escape.ts", action: "create", content: "x", reason: "bad", relatedDesignNodeIds: [] }], packageChanges: [], commandsRequested: [], assumptions: [], unresolvedItems: [] }, root)).toThrow(); expect(() => validateProposedFileChanges({ schemaVersion: "1", projectId: "p1", baseProjectFingerprint: "fp", files: [{ path: "src/x.ts", action: "modify", content: "x", reason: "bad", relatedDesignNodeIds: [] }], packageChanges: [], commandsRequested: [], assumptions: [], unresolvedItems: [] }, root)).toThrow(); await rm(root, { recursive: true, force: true }); });
  test("applies approved changes, snapshots them, and rolls back", async () => { const root = await fixture(); const state = await mkdtemp(join(tmpdir(), "designflow-state-")); const proposal = { schemaVersion: "1" as const, projectId: "p1", baseProjectFingerprint: "fp", files: [{ path: "src/New.ts", action: "create" as const, content: "export const value = 1;\n", reason: "test", relatedDesignNodeIds: [] }], packageChanges: [], commandsRequested: [], assumptions: [], unresolvedItems: [] }; const result = await applyProjectFileChanges("p1", root, proposal, projectRootIdentity(root), state); expect(await readFile(join(root, "src/New.ts"), "utf8")).toContain("value"); await rollbackProjectSnapshot(root, result.snapshot); await expect(readFile(join(root, "src/New.ts"))).rejects.toBeDefined(); await rm(root, { recursive: true, force: true }); await rm(state, { recursive: true, force: true }); });
  test("restores a modified file during rollback", async () => { const root = await fixture(); const state = await mkdtemp(join(tmpdir(), "designflow-state-")); const original = await readFile(join(root, "src/components/Button.tsx"), "utf8"); const proposal = { schemaVersion: "1" as const, projectId: "p1", baseProjectFingerprint: "fp", files: [{ path: "src/components/Button.tsx", action: "modify" as const, content: "export function Button() { return <button>changed</button>; }\n", expectedBaseHash: projectFileHash(join(root, "src/components/Button.tsx")), reason: "test", relatedDesignNodeIds: [] }], packageChanges: [], commandsRequested: [], assumptions: [], unresolvedItems: [] }; const result = await applyProjectFileChanges("p1", root, proposal, projectRootIdentity(root), state); expect(await readFile(join(root, "src/components/Button.tsx"), "utf8")).toContain("changed"); await rollbackProjectSnapshot(root, result.snapshot); expect(await readFile(join(root, "src/components/Button.tsx"), "utf8")).toBe(original); await rm(root, { recursive: true, force: true }); await rm(state, { recursive: true, force: true }); });
  test("binds approval to proposal and project fingerprint", () => { const proposal = { schemaVersion: "1" as const, projectId: "p1", baseProjectFingerprint: "fp", files: [], packageChanges: [], commandsRequested: [], assumptions: [], unresolvedItems: [] }; const binding = createApprovalBinding("proposal-1", proposal, new Date("2026-01-01T00:00:00Z")); expect(() => verifyApproval({ ...binding, status: "approved" }, "proposal-1", proposal, "changed")).toThrow(); });
  test("enforces inspection limits and skips symlink escapes", async () => { const root = await fixture(); const outside = await mkdtemp(join(tmpdir(), "designflow-outside-")); await writeFile(join(outside, "secret.ts"), "export const secret = true"); await symlink(outside, join(root, "src/outside")); const limited = inspectRegisteredProject({ id: "p1", name: "Fixture", rootPath: root }, { maxFiles: 1 }); const safe = inspectRegisteredProject({ id: "p1", name: "Fixture", rootPath: root }); expect(limited.warnings.some((warning) => warning.code === "FILE_COUNT_LIMIT")).toBe(true); expect(safe.warnings.some((warning) => warning.code === "SYMLINK_SKIPPED")).toBe(true); await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); });
  test("changes fingerprint only after source mutation", async () => { const root = await fixture(); const first = inspectRegisteredProject({ id: "p1", name: "Fixture", rootPath: root }); const second = inspectRegisteredProject({ id: "p1", name: "Fixture", rootPath: root }); expect(second.project.contextFingerprint).toBe(first.project.contextFingerprint); await writeFile(join(root, "src/App.tsx"), "export const App = () => null;\n"); const third = inspectRegisteredProject({ id: "p1", name: "Fixture", rootPath: root }); expect(third.project.contextFingerprint).not.toBe(first.project.contextFingerprint); await rm(root, { recursive: true, force: true }); });
  test("fails rollback when an applied file was externally modified", async () => { const root = await fixture(); const state = await mkdtemp(join(tmpdir(), "designflow-state-")); const proposal = { schemaVersion: "1" as const, projectId: "p1", baseProjectFingerprint: "fp", files: [{ path: "src/New.ts", action: "create" as const, content: "export const value = 1;\n", reason: "test", relatedDesignNodeIds: [] }], packageChanges: [], commandsRequested: [], assumptions: [], unresolvedItems: [] }; const result = await applyProjectFileChanges("p1", root, proposal, projectRootIdentity(root), state); await writeFile(join(root, "src/New.ts"), "external mutation\n"); await expect(rollbackProjectSnapshot(root, result.snapshot)).rejects.toThrow(); expect(projectFileHash(join(root, "src/New.ts"))).toBeDefined(); await rm(root, { recursive: true, force: true }); await rm(state, { recursive: true, force: true }); });
  test("rejects overlapping project writes before snapshot creation", async () => { const root = await fixture(); const state = await mkdtemp(join(tmpdir(), "designflow-state-")); const identity = projectRootIdentity(root); const owner = await acquireProjectWriteLock("p1", identity, state); await expect(acquireProjectWriteLock("p1", identity, state)).rejects.toMatchObject({ code: "ERR_PROJECT_WRITE_LOCKED" }); await owner.release(); const second = await acquireProjectWriteLock("p1", identity, state); await second.release(); await rm(root, { recursive: true, force: true }); await rm(state, { recursive: true, force: true }); });
  test("rejects unsupported and private targets", async () => { const root = await fixture(); const base = { schemaVersion: "1" as const, projectId: "p1", baseProjectFingerprint: "fp", packageChanges: [], commandsRequested: [], assumptions: [], unresolvedItems: [] }; expect(() => validateProposedFileChanges({ ...base, files: [{ path: "src/run.sh", action: "create", content: "echo unsafe", reason: "bad", relatedDesignNodeIds: [] }] }, root)).toThrow(); expect(() => validateProposedFileChanges({ ...base, files: [{ path: ".env", action: "create", content: "secret", reason: "bad", relatedDesignNodeIds: [] }] }, root)).toThrow(); await rm(root, { recursive: true, force: true }); });
  test("discovers .jsx and .js components alongside .tsx in the inventory", async () => {
    const root = await fixture();
    await writeFile(join(root, "src/components/FeatureCard.jsx"), "export default function FeatureCard({ eyebrow, title }) { return <article>{title}</article>; }\n");
    await writeFile(join(root, "src/components/PrimaryButton.jsx"), "export default function PrimaryButton({ children }) { return <button>{children}</button>; }\n");
    await writeFile(join(root, "src/components/Legacy.js"), "export function Legacy() { return null; }\n");
    const context = inspectRegisteredProject({ id: "p1", name: "Fixture", rootPath: root });
    const names = context.designSystem.components.map((component) => component.name);
    expect(names).toContain("FeatureCard");
    expect(names).toContain("PrimaryButton");
    expect(names).toContain("Legacy");
    expect(names).toContain("Button");
    const card = context.designSystem.components.find((component) => component.name === "FeatureCard")!;
    expect(card.sourcePath).toBe("src/components/FeatureCard.jsx");
    await rm(root, { recursive: true, force: true });
  });

  test("discovered .jsx components are visible to design-system mapping", async () => {
    const root = await fixture();
    await writeFile(join(root, "src/components/PrimaryButton.jsx"), "export default function PrimaryButton({ children }) { return <button>{children}</button>; }\n");
    const context = inspectRegisteredProject({ id: "p1", name: "Fixture", rootPath: root });
    const jsxSpec = { ...spec, components: [{ name: "PrimaryButton", role: "button", sourceNodeIds: ["node-1"], variants: [], requiredAssets: [], implementationNotes: [] }] };
    const mapping = mapDesignSystem(jsxSpec, context);
    const entry = mapping.componentMappings.find((m) => m.designComponentId === "PrimaryButton")!;
    expect(entry.action).toBe("reuse");
    expect(entry.projectComponentReference).toBe("PrimaryButton");
    await rm(root, { recursive: true, force: true });
  });

  test("proposal operation semantics are validated against the real baseline", async () => {
    const root = await fixture();
    const base = { schemaVersion: "1" as const, projectId: "p1", baseProjectFingerprint: "fp", packageChanges: [], commandsRequested: [], assumptions: [], unresolvedItems: [] };
    const buttonHash = projectFileHash(join(root, "src/components/Button.tsx"))!;
    // modify existing → valid
    expect(() => validateProposedFileChanges({ ...base, files: [{ path: "src/components/Button.tsx", action: "modify", content: "x", expectedBaseHash: buttonHash, reason: "ok", relatedDesignNodeIds: [] }] }, root)).not.toThrow();
    // modify nonexistent (with a hash the model made up) → invalid
    expect(() => validateProposedFileChanges({ ...base, files: [{ path: "src/components/Button.js", action: "modify", content: "x", expectedBaseHash: buttonHash, reason: "bad", relatedDesignNodeIds: [] }] }, root)).toThrow(expect.objectContaining({ code: "ERR_PROPOSAL_TARGET_MISSING" }));
    // create nonexistent → valid
    expect(() => validateProposedFileChanges({ ...base, files: [{ path: "src/components/New.tsx", action: "create", content: "x", reason: "ok", relatedDesignNodeIds: [] }] }, root)).not.toThrow();
    // create existing → invalid
    expect(() => validateProposedFileChanges({ ...base, files: [{ path: "src/components/Button.tsx", action: "create", content: "x", reason: "bad", relatedDesignNodeIds: [] }] }, root)).toThrow(expect.objectContaining({ code: "ERR_PROPOSAL_TARGET_EXISTS" }));
    // delete existing → valid
    expect(() => validateProposedFileChanges({ ...base, files: [{ path: "src/components/Button.tsx", action: "delete", reason: "ok", relatedDesignNodeIds: [] }] }, root)).not.toThrow();
    // delete nonexistent → invalid
    expect(() => validateProposedFileChanges({ ...base, files: [{ path: "src/components/Gone.tsx", action: "delete", reason: "bad", relatedDesignNodeIds: [] }] }, root)).toThrow(expect.objectContaining({ code: "ERR_PROPOSAL_TARGET_MISSING" }));
    // duplicate conflicting operations on one path → invalid
    expect(() => validateProposedFileChanges({ ...base, files: [
      { path: "src/components/New.tsx", action: "create", content: "x", reason: "a", relatedDesignNodeIds: [] },
      { path: "src/components/New.tsx", action: "modify", content: "y", expectedBaseHash: buttonHash, reason: "b", relatedDesignNodeIds: [] },
    ] }, root)).toThrow(expect.objectContaining({ code: "ERR_DUPLICATE_PROPOSAL_ACTION" }));
    await rm(root, { recursive: true, force: true });
  });

  test("apply-time validation tolerates a resumed partial apply without weakening hashes", async () => {
    const root = await fixture();
    const state = await mkdtemp(join(tmpdir(), "designflow-state-"));
    const proposal = { schemaVersion: "1" as const, projectId: "p1", baseProjectFingerprint: "fp", files: [{ path: "src/Resumed.ts", action: "create" as const, content: "export const value = 1;\n", reason: "test", relatedDesignNodeIds: [] }], packageChanges: [], commandsRequested: [], assumptions: [], unresolvedItems: [] };
    const first = await applyProjectFileChanges("p1", root, proposal, projectRootIdentity(root), state);
    // A second apply of the same proposal (resume) finds its own file and succeeds.
    const second = await applyProjectFileChanges("p1", root, proposal, projectRootIdentity(root), state);
    expect(second.proposalHash).toBe(first.proposalHash);
    await rm(root, { recursive: true, force: true });
    await rm(state, { recursive: true, force: true });
  });

  test("marks missing checks unavailable and never runs model-requested commands", async () => { const root = await fixture(); const context = inspectRegisteredProject({ id: "p1", name: "Fixture", rootPath: root }); const checks = await validateProject({ ...context, commands: { ...context.commands, lint: undefined, test: undefined } }, root); expect(checks.find((check) => check.name === "lint")?.status).toBe("unavailable"); expect(checks.find((check) => check.name === "build")?.status).toBe("passed"); await rm(root, { recursive: true, force: true }); });
});

// ── Post-release remediation: inspection budget must prioritize source dirs ──

describe("inspection source prioritization", () => {
  test("components survive the file budget even when early-alphabetical junk would exhaust it", async () => {
    const root = await mkdtemp(join(tmpdir(), "designflow-priority-"));
    await mkdir(join(root, "assets"), { recursive: true });
    await mkdir(join(root, "src/components"), { recursive: true });
    for (let i = 0; i < 30; i += 1) await writeFile(join(root, "assets", `junk-${String(i).padStart(2, "0")}.json`), "{}");
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "priority", dependencies: { react: "19.0.0" } }));
    await writeFile(join(root, "src/components/Button.tsx"), "export function Button({ label }: { label: string }) { return null; }\n");
    const context = inspectRegisteredProject({ id: "p1", name: "Priority", rootPath: root }, { maxFiles: 10 });
    expect(context.warnings.some((warning) => warning.code === "FILE_COUNT_LIMIT")).toBe(true);
    expect(context.designSystem.components.map((component) => component.sourcePath)).toContain("src/components/Button.tsx");
    await rm(root, { recursive: true, force: true });
  });
});

// ── Field defect DF-REAL-02: separate export statements must be discovered ──

describe("component export-style discovery", () => {
  async function projectWith(button: string) {
    const root = await mkdtemp(join(tmpdir(), "designflow-exports-"));
    await mkdir(join(root, "src/components"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "exports", dependencies: { react: "19.0.0" } }));
    await writeFile(join(root, "src/components/Button.tsx"), button);
    return root;
  }

  test("a component declared first and exported via `export { Button };` is discovered and trusted (the real Spendly shape)", async () => {
    const root = await projectWith('"use client";\n\nimport React from \'react\';\n\nconst Button = ({ children }: { children: React.ReactNode }) => {\n  return <button>{children}</button>;\n};\n\nexport { Button };\n');
    const context = inspectRegisteredProject({ id: "p1", name: "Exports", rootPath: root });
    expect(context.designSystem.components.map((c) => c.sourcePath)).toContain("src/components/Button.tsx");
    expect(context.designSystem.components.find((c) => c.sourcePath === "src/components/Button.tsx")?.name).toBe("Button");
    await rm(root, { recursive: true, force: true });
  });

  test("`export default Button;` and `export { Button as default };` are discovered too", async () => {
    for (const style of ["const Button = () => null;\nexport default Button;\n", "const Button = () => null;\nexport { Button as default };\n"]) {
      const root = await projectWith(style);
      const context = inspectRegisteredProject({ id: "p1", name: "Exports", rootPath: root });
      expect(context.designSystem.components.find((c) => c.sourcePath === "src/components/Button.tsx")?.name).toBe("Button");
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a components file with no value export at all stays undiscovered", async () => {
    const root = await projectWith("export type ButtonProps = { label: string };\n");
    const context = inspectRegisteredProject({ id: "p1", name: "Exports", rootPath: root });
    expect(context.designSystem.components.map((c) => c.sourcePath)).not.toContain("src/components/Button.tsx");
    await rm(root, { recursive: true, force: true });
  });
});
