import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { DesignFlowError } from "@designflow/sdk";
import { assertGitSafeForWrite, inspectGitSafety } from "../../project-mutation/git-safety";

function git(root: string, ...args: string[]): void {
  execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
}

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), "designflow-git-safety-"));
  git(root, "init", "-q");
  git(root, "config", "user.email", "designflow-tests@example.invalid");
  git(root, "config", "user.name", "DesignFlow tests");
  writeFileSync(join(root, "src.ts"), "export const value = 1;\n");
  git(root, "add", "src.ts");
  git(root, "commit", "-qm", "fixture");
  return root;
}

describe("Git-aware project safety", () => {
  test("reports clean repositories and allows unrelated dirty files", () => {
    const root = repository();
    try {
      expect(inspectGitSafety(root, ["src.ts"]).isRepository).toBe(true);
      expect(inspectGitSafety(root, ["src.ts"]).dirty).toBe(false);
      writeFileSync(join(root, "notes.txt"), "user work\n");
      const report = inspectGitSafety(root, ["src.ts"]);
      expect(report.dirty).toBe(true);
      expect(report.targetDirty).toBe(false);
      expect(report.unrelatedDirtyPaths).toEqual(["notes.txt"]);
      expect(() => assertGitSafeForWrite(report)).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("blocks dirty and staged proposal targets", () => {
    const root = repository();
    try {
      writeFileSync(join(root, "src.ts"), "export const value = 2;\n");
      const report = inspectGitSafety(root, ["src.ts"]);
      expect(report.targetDirty).toBe(true);
      expect(() => assertGitSafeForWrite(report)).toThrow(DesignFlowError);
      expect(() => assertGitSafeForWrite(report)).toThrow("uncommitted Git changes");

      git(root, "add", "src.ts");
      const staged = inspectGitSafety(root, ["src.ts"]);
      expect(staged.stagedTargetPaths).toEqual(["src.ts"]);
      expect(() => assertGitSafeForWrite(staged)).toThrow("uncommitted Git changes");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("does not require Git for non-Git projects", () => {
    const root = mkdtempSync(join(tmpdir(), "designflow-non-git-"));
    try {
      const report = inspectGitSafety(root, ["src.ts"]);
      expect(report.isRepository).toBe(false);
      expect(report.warnings[0]).toContain("not a Git repository");
      expect(() => assertGitSafeForWrite(report)).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("blocks an in-progress merge without touching user state", () => {
    const root = repository();
    try {
      const marker = join(root, ".git", "MERGE_HEAD");
      writeFileSync(marker, "0123456789012345678901234567890123456789\n");
      const report = inspectGitSafety(root, ["src.ts"]);
      expect(existsSync(marker)).toBe(true);
      expect(report.mergeOrRebaseInProgress).toBe(true);
      expect(() => assertGitSafeForWrite(report)).toThrow("merge, rebase, or cherry-pick");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("DesignFlow-owned dirty-target exemption (MVP-4H)", () => {
  test("an exempted just-applied target passes; a non-exempt dirty target still blocks", () => {
    const root = repository();
    try {
      writeFileSync(join(root, "applied.ts"), "export const applied = 1;\n");
      writeFileSync(join(root, "other.ts"), "export const other = 1;\n");
      const report = inspectGitSafety(root, ["applied.ts", "other.ts"]);
      expect(report.dirtyTargetPaths.sort()).toEqual(["applied.ts", "other.ts"]);
      // Exempting only the DesignFlow-applied file still blocks on the other.
      expect(() => assertGitSafeForWrite(report, { exemptDirtyTargets: new Set(["applied.ts"]) })).toThrow("uncommitted Git changes");
      // Exempting both dirty targets allows the write.
      expect(() => assertGitSafeForWrite(report, { exemptDirtyTargets: new Set(["applied.ts", "other.ts"]) })).not.toThrow();
      // Without an exemption the original behavior is unchanged.
      expect(() => assertGitSafeForWrite(report)).toThrow(DesignFlowError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
