import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import { proposedFileChangesSchema, stage6FailpointEnabled, terminateAtStage6Failpoint, type ProposedFileChanges } from "@designflow/sdk";
import { ImplementationError } from "./errors";
import { projectFileHash, validateProposedFileChanges } from "./proposal";
import { assertGitSafeForWrite, inspectGitSafety, type GitSafetyReport } from "./git-safety";
import { acquireProjectWriteLock } from "./project-write-lock";

export interface SnapshotEntry { path: string; existed: boolean; content?: string; hash?: string; postWriteHash?: string; mode?: number; }
export interface ProjectSnapshot { runId: string; projectId: string; proposalHash: string; rootIdentity: string; createdAt: string; entries: SnapshotEntry[]; gitSafety?: GitSafetyReport; }
export interface ApplicationResult { runId: string; projectId: string; proposalHash: string; changedFiles: string[]; createdFiles: string[]; modifiedFiles: string[]; snapshot: ProjectSnapshot; }
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const rootIdentityHash = (root: string) => createHash("sha256").update(realpathSync(root)).digest("hex");
export function projectRootIdentity(root: string): string { return rootIdentityHash(root); }
async function exists(path: string): Promise<boolean> { try { await stat(path); return true; } catch { return false; } }
function target(root: string, path: string): string { const result = normalize(join(root, path)); if (!result.startsWith(normalize(root) + sep)) throw new ImplementationError("ERR_UNSAFE_PATH", `Target escapes registered project: ${path}`); return result; }
function assertStateDirectory(root: string, stateDirectory: string): void { const project = resolve(root); const state = resolve(stateDirectory); const inside = relative(project, state); if (!inside.startsWith(`..${sep}`) && inside !== ".." && inside !== "") throw new ImplementationError("ERR_UNSAFE_STATE_PATH", "Snapshots cannot be stored inside the registered project."); }
async function persistSnapshot(stateDirectory: string, snapshot: ProjectSnapshot): Promise<void> { await writeFile(join(stateDirectory, `${snapshot.runId}.json`), JSON.stringify(snapshot), "utf8"); }
async function findResumableSnapshot(projectId: string, rootIdentity: string, proposalHash: string, stateDirectory: string): Promise<ProjectSnapshot | undefined> {
  try {
    for (const name of await readdir(stateDirectory)) {
      if (!name.endsWith(".json")) continue;
      try {
        const candidate = JSON.parse(await readFile(join(stateDirectory, name), "utf8")) as ProjectSnapshot;
        if (candidate.projectId === projectId && candidate.rootIdentity === rootIdentity && candidate.proposalHash === proposalHash && Array.isArray(candidate.entries)) return candidate;
      } catch { /* Unrelated or incomplete state files are ignored. */ }
    }
  } catch { /* The state directory may not exist on the first application. */ }
  return undefined;
}

export async function createProjectSnapshot(projectId: string, root: string, proposal: ProposedFileChanges, rootIdentity: string, stateDirectory: string): Promise<ProjectSnapshot> {
  assertStateDirectory(root, stateDirectory);
  const entries: SnapshotEntry[] = [];
  for (const file of proposal.files) { const path = target(root, file.path); if (await exists(path)) { const data = await readFile(path); const mode = (await stat(path)).mode; entries.push({ path: file.path, existed: true, content: data.toString("base64"), hash: createHash("sha256").update(data.toString("base64")).digest("hex"), mode }); } else entries.push({ path: file.path, existed: false }); }
  const gitSafety = inspectGitSafety(root, proposal.files.map((file) => file.path));
  assertGitSafeForWrite(gitSafety);
  const snapshot = { runId: randomUUID(), projectId, proposalHash: hash(proposal), rootIdentity, createdAt: new Date().toISOString(), entries, ...(gitSafety.isRepository ? { gitSafety } : {}) };
  await mkdir(stateDirectory, { recursive: true }); await persistSnapshot(stateDirectory, snapshot);
  return snapshot;
}

export async function applyProjectFileChanges(projectId: string, root: string, proposal: ProposedFileChanges, rootIdentity: string, stateDirectory: string, existingSnapshot?: ProjectSnapshot): Promise<ApplicationResult> {
  const validated = validateProposedFileChanges(proposedFileChangesSchema.parse(proposal), root); const proposalHash = hash(validated); const lock = await acquireProjectWriteLock(projectId, rootIdentity, stateDirectory); let snapshot: ProjectSnapshot | undefined;
  try {
    const persistedSnapshot = await findResumableSnapshot(projectId, rootIdentity, proposalHash, stateDirectory); snapshot = persistedSnapshot ?? existingSnapshot ?? await createProjectSnapshot(projectId, root, validated, rootIdentity, stateDirectory); if (snapshot.projectId !== projectId || snapshot.rootIdentity !== rootIdentity || snapshot.proposalHash !== proposalHash) throw new ImplementationError("ERR_SNAPSHOT_PROJECT_MISMATCH", "The snapshot does not belong to this project and proposal.");
    try {
      for (const [index, file] of validated.files.entries()) {
        if (file.action === "delete") throw new ImplementationError("ERR_PROPOSAL_INVALID", "Deletion is disabled by default in Stage 4.");
        const path = target(root, file.path); const current = projectFileHash(path); const entry = snapshot.entries.find((candidate) => candidate.path === file.path); if (entry?.postWriteHash !== undefined && current === entry.postWriteHash) continue; if (file.action === "modify" && current !== file.expectedBaseHash) throw new ImplementationError("ERR_TARGET_FILE_CHANGED", `Target changed since proposal creation: ${file.path}`); if (file.action === "create" && current !== undefined) throw new ImplementationError("ERR_TARGET_FILE_CHANGED", `Target already exists: ${file.path}`);
        const temp = `${path}.designflow-${snapshot.runId}.tmp`; await mkdir(dirname(path), { recursive: true }); await writeFile(temp, file.content ?? "", "utf8"); await rename(temp, path); const writtenHash = projectFileHash(path); if (entry && writtenHash !== undefined) { entry.postWriteHash = writtenHash; await persistSnapshot(stateDirectory, snapshot); }
        if (index === 0 && stage6FailpointEnabled("after_first_correction_write")) terminateAtStage6Failpoint("after_first_correction_write");
      }
    } catch (error) { await rollbackProjectSnapshot(root, snapshot); throw error; }
    return { runId: snapshot.runId, projectId, proposalHash: snapshot.proposalHash, changedFiles: validated.files.map((file) => file.path), createdFiles: validated.files.filter((f) => f.action === "create").map((f) => f.path), modifiedFiles: validated.files.filter((f) => f.action === "modify").map((f) => f.path), snapshot };
  } finally { await lock.release(); }
}

export async function rollbackProjectSnapshot(root: string, snapshot: ProjectSnapshot, options: { force?: boolean } = {}): Promise<void> {
  if (snapshot.rootIdentity !== rootIdentityHash(root)) throw new ImplementationError("ERR_SNAPSHOT_PROJECT_MISMATCH", "The snapshot does not belong to this registered project.");
  for (const entry of snapshot.entries) { const path = target(root, entry.path); if (!options.force && entry.postWriteHash !== undefined && projectFileHash(path) !== entry.postWriteHash) throw new ImplementationError("ERR_ROLLBACK_EXTERNAL_CHANGE", `Rollback refused because ${entry.path} changed outside DesignFlow.`); if (entry.existed) { if (entry.content === undefined) throw new ImplementationError("ERR_ROLLBACK_FAILED", `Snapshot has no backup for ${entry.path}`); await mkdir(dirname(path), { recursive: true }); await writeFile(path, entry.content, "base64"); if (entry.mode !== undefined) await chmod(path, entry.mode); } else await rm(path, { force: true }); }
}
