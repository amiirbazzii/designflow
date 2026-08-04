import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";

export interface ProjectGitStatus {
  readonly isGit: boolean;
  readonly dirty: boolean;
  readonly branch?: string;
  readonly mergeOrRebaseInProgress: boolean;
}

function command(root: string, args: readonly string[]): string | undefined {
  try {
    return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2_000, shell: false });
  } catch {
    return undefined;
  }
}

export function inspectProjectGit(root: string): ProjectGitStatus {
  const canonical = realpathSync(root);
  if (command(canonical, ["rev-parse", "--is-inside-work-tree"])?.trim() !== "true") return { isGit: false, dirty: false, mergeOrRebaseInProgress: false };
  const gitDir = command(canonical, ["rev-parse", "--git-dir"])?.trim();
  const branch = command(canonical, ["symbolic-ref", "--short", "HEAD"])?.trim();
  const status = command(canonical, ["status", "--porcelain=v1", "--untracked-files=all"]) ?? "";
  const absoluteGitDir = gitDir === undefined ? undefined : realpathSync(join(canonical, gitDir));
  const mergeOrRebaseInProgress = absoluteGitDir !== undefined && ["MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD"].some((entry) => existsSync(join(absoluteGitDir, entry)));
  return { isGit: true, dirty: status.trim().length > 0, ...(branch !== undefined && branch.length > 0 ? { branch } : {}), mergeOrRebaseInProgress };
}
