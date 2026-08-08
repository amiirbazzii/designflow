import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { join, normalize, relative, resolve, sep } from "node:path";
import { DesignFlowError } from "@designflow/sdk";

export interface GitSafetyReport {
  readonly isRepository: boolean;
  readonly root: string;
  readonly branch?: string;
  readonly detached: boolean;
  readonly dirty: boolean;
  readonly targetDirty: boolean;
  readonly targetPaths: readonly string[];
  /** The subset of target paths git currently reports as changed/untracked. */
  readonly dirtyTargetPaths: readonly string[];
  readonly unrelatedDirtyPaths: readonly string[];
  readonly stagedTargetPaths: readonly string[];
  readonly mergeOrRebaseInProgress: boolean;
  readonly warnings: readonly string[];
}

interface GitCommandResult {
  readonly status: number;
  readonly stdout: string;
}

function git(root: string, args: readonly string[]): GitCommandResult {
  try {
    return {
      status: 0,
      stdout: execFileSync("git", ["-C", root, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 2_000,
        shell: false,
      }),
    };
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : 1;
    return { status, stdout: "" };
  }
}

function relativeTarget(root: string, path: string): string {
  const absolute = resolve(root, path);
  const normalizedRoot = resolve(root);
  const rel = relative(normalizedRoot, absolute);
  if (rel === "" || rel.startsWith(`..${sep}`) || rel === "..")
    throw new DesignFlowError("ERR_UNSAFE_PATH", `Git safety target is outside the registered project: ${path}`);
  return normalize(rel).split(sep).join("/");
}

function gitDirectory(root: string): string | undefined {
  const result = git(root, ["rev-parse", "--git-dir"]);
  const gitDir = result.stdout.trim();
  if (result.status !== 0 || gitDir.length === 0) return undefined;
  return resolve(root, gitDir);
}

function parseStatus(status: string): readonly { readonly index: string; readonly worktree: string; readonly path: string }[] {
  return status
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length >= 3)
    .map((line) => ({
      index: line[0] ?? " ",
      worktree: line[1] ?? " ",
      path: line.slice(3).split(" -> ").at(-1) ?? line.slice(3),
    }));
}

export function inspectGitSafety(root: string, targetPaths: readonly string[] = []): GitSafetyReport {
  const canonicalRoot = realpathSync(root);
  const repository = git(canonicalRoot, ["rev-parse", "--is-inside-work-tree"]);
  if (repository.status !== 0 || repository.stdout.trim() !== "true") {
    return {
      isRepository: false,
      root: canonicalRoot,
      detached: false,
      dirty: false,
      targetDirty: false,
      targetPaths: [],
      dirtyTargetPaths: [],
      unrelatedDirtyPaths: [],
      stagedTargetPaths: [],
      mergeOrRebaseInProgress: false,
      warnings: ["The project is not a Git repository; file-hash and snapshot safety remain active."],
    };
  }

  const targets = targetPaths.map((path) => relativeTarget(canonicalRoot, path));
  const targetSet = new Set(targets);
  const statuses = parseStatus(git(canonicalRoot, ["status", "--porcelain=v1", "--untracked-files=all"]).stdout);
  const dirtyPaths = statuses.map((entry) => entry.path);
  const targetStatuses = statuses.filter((entry) => targetSet.has(entry.path));
  const gitDir = gitDirectory(canonicalRoot);
  const mergeOrRebaseInProgress = gitDir !== undefined && [
    join(gitDir, "MERGE_HEAD"),
    join(gitDir, "rebase-merge"),
    join(gitDir, "rebase-apply"),
    join(gitDir, "CHERRY_PICK_HEAD"),
  ].some(existsSync);
  const branchResult = git(canonicalRoot, ["symbolic-ref", "--short", "HEAD"]);
  const branch = branchResult.status === 0 && branchResult.stdout.trim().length > 0 ? branchResult.stdout.trim() : undefined;
  const report: GitSafetyReport = {
    isRepository: true,
    root: canonicalRoot,
    ...(branch !== undefined ? { branch } : {}),
    detached: branch === undefined,
    dirty: dirtyPaths.length > 0,
    targetDirty: targetStatuses.length > 0,
    targetPaths: targets,
    dirtyTargetPaths: targetStatuses.map((entry) => entry.path),
    unrelatedDirtyPaths: dirtyPaths.filter((path) => !targetSet.has(path)),
    stagedTargetPaths: targetStatuses.filter((entry) => entry.index !== " ").map((entry) => entry.path),
    mergeOrRebaseInProgress,
    warnings: [
      ...(dirtyPaths.length > 0 ? ["The Git working tree is dirty; unrelated changes will be preserved."] : []),
      ...(targetStatuses.length > 0 ? ["A proposed target file already has Git changes and cannot be overwritten safely."] : []),
      ...(mergeOrRebaseInProgress ? ["Git reports an in-progress merge, rebase, or cherry-pick."] : []),
      ...(branch === undefined ? ["The repository is in detached HEAD state."] : []),
    ],
  };
  return report;
}

export function assertGitSafeForWrite(report: GitSafetyReport, options: { readonly exemptDirtyTargets?: ReadonlySet<string> } = {}): void {
  if (report.mergeOrRebaseInProgress)
    throw new DesignFlowError("ERR_GIT_CONFLICT_STATE", "Project writes are blocked while Git is in a merge, rebase, or cherry-pick state.", { root: report.root });
  // A dirty target is exempt only when the caller proves DesignFlow itself
  // wrote it in the current journey (recorded in the parent run's applied
  // proposal, still base-hash-verified against the file's current content,
  // and covered by that run's own rollback snapshot). Without that
  // provenance, uncommitted target changes still block the write — otherwise
  // a correction of a just-applied implementation would be structurally
  // impossible, since its targets are uncommitted by definition.
  const blocking = (report.dirtyTargetPaths ?? []).filter((path) => !(options.exemptDirtyTargets?.has(path) ?? false));
  if (blocking.length > 0)
    throw new DesignFlowError("ERR_GIT_DIRTY_TARGET", "Project writes are blocked because a proposed target file has uncommitted Git changes.", { targetPaths: report.targetPaths, stagedTargetPaths: report.stagedTargetPaths, blockingTargetPaths: blocking });
}
