import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { validateProposedFileChanges, projectFileHash } from "./proposal";

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "designflow-content-integrity-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src/Page.tsx"), "export const value = 1;\n");
  writeFileSync(join(root, "src/styles.css"), ":root { --ink: #111; }\n");
  return root;
}

function proposal(root: string, files: Array<{ path: string; action: "create" | "modify"; content: string }>) {
  return {
    schemaVersion: "1", projectId: "p1", baseProjectFingerprint: "f".repeat(64),
    files: files.map((file) => ({ ...file, ...(file.action === "modify" ? { expectedBaseHash: projectFileHash(join(root, file.path)) } : {}), reason: "test", relatedDesignNodeIds: [] })),
    packageChanges: [], commandsRequested: [], assumptions: [], unresolvedItems: [],
  };
}

describe("implementation proposal content integrity", () => {
  test("an empty executable create is rejected", () => {
    const root = fixture();
    try {
      expect(() => validateProposedFileChanges(proposal(root, [{ path: "src/NewScreen.jsx", action: "create", content: "" }]) as never, root)).toThrow("non-whitespace source content");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("a whitespace-only executable modify is rejected", () => {
    const root = fixture();
    try {
      expect(() => validateProposedFileChanges(proposal(root, [{ path: "src/Page.tsx", action: "modify", content: "  \n\t" }]) as never, root)).toThrow("non-whitespace source content");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("valid minimal executable content passes — no minimum-length heuristic", () => {
    const root = fixture();
    try {
      expect(() => validateProposedFileChanges(proposal(root, [{ path: "src/Page.tsx", action: "modify", content: "export {};\n" }]) as never, root)).not.toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("an exact byte-identical no-op modify is rejected", () => {
    const root = fixture();
    try {
      expect(() => validateProposedFileChanges(proposal(root, [{ path: "src/Page.tsx", action: "modify", content: "export const value = 1;\n" }]) as never, root)).toThrow("identical to the current file");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("a real one-character modify is not a no-op and passes", () => {
    const root = fixture();
    try {
      expect(() => validateProposedFileChanges(proposal(root, [{ path: "src/Page.tsx", action: "modify", content: "export const value = 2;\n" }]) as never, root)).not.toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("empty non-executable content is not covered by the executable rule", () => {
    const root = fixture();
    try {
      expect(() => validateProposedFileChanges(proposal(root, [{ path: "src/new.css", action: "create", content: "" }]) as never, root)).not.toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("apply-time revalidation (existence checks off) does not misread its own written file as a no-op", () => {
    const root = fixture();
    try {
      expect(() => validateProposedFileChanges(proposal(root, [{ path: "src/Page.tsx", action: "modify", content: "export const value = 1;\n" }]) as never, root, undefined, { checkTargetExistence: false })).not.toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
