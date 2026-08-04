import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import { proposedFileChangesSchema, type ProposedFileChanges } from "@designflow/sdk";
import { ImplementationError } from "./errors";
import { projectFileHash, validateProposedFileChanges } from "./proposal";

export interface SnapshotEntry { path: string; existed: boolean; content?: string; hash?: string; postWriteHash?: string; mode?: number; }
export interface ProjectSnapshot { runId: string; projectId: string; proposalHash: string; rootIdentity: string; createdAt: string; entries: SnapshotEntry[]; }
export interface ApplicationResult { runId: string; projectId: string; proposalHash: string; changedFiles: string[]; createdFiles: string[]; modifiedFiles: string[]; snapshot: ProjectSnapshot; }
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const rootIdentityHash = (root: string) => createHash("sha256").update(realpathSync(root)).digest("hex");
export function projectRootIdentity(root: string): string { return rootIdentityHash(root); }
async function exists(path: string): Promise<boolean> { try { await stat(path); return true; } catch { return false; } }
function target(root: string, path: string): string { const result = normalize(join(root, path)); if (!result.startsWith(normalize(root) + sep)) throw new ImplementationError("ERR_UNSAFE_PATH", `Target escapes registered project: ${path}`); return result; }
function assertStateDirectory(root: string, stateDirectory: string): void { const project = resolve(root); const state = resolve(stateDirectory); const inside = relative(project, state); if (!inside.startsWith(`..${sep}`) && inside !== ".." && inside !== "") throw new ImplementationError("ERR_UNSAFE_STATE_PATH", "Snapshots cannot be stored inside the registered project."); }

export async function createProjectSnapshot(projectId: string, root: string, proposal: ProposedFileChanges, rootIdentity: string, stateDirectory: string): Promise<ProjectSnapshot> {
  assertStateDirectory(root, stateDirectory);
  const entries: SnapshotEntry[] = [];
  for (const file of proposal.files) { const path = target(root, file.path); if (await exists(path)) { const data = await readFile(path); const mode = (await stat(path)).mode; entries.push({ path: file.path, existed: true, content: data.toString("base64"), hash: createHash("sha256").update(data.toString("base64")).digest("hex"), mode }); } else entries.push({ path: file.path, existed: false }); }
  const snapshot = { runId: randomUUID(), projectId, proposalHash: hash(proposal), rootIdentity, createdAt: new Date().toISOString(), entries };
  await mkdir(stateDirectory, { recursive: true }); await writeFile(join(stateDirectory, `${snapshot.runId}.json`), JSON.stringify(snapshot), "utf8");
  return snapshot;
}

export async function applyProjectFileChanges(projectId: string, root: string, proposal: ProposedFileChanges, rootIdentity: string, stateDirectory: string, existingSnapshot?: ProjectSnapshot): Promise<ApplicationResult> {
  const validated = validateProposedFileChanges(proposedFileChangesSchema.parse(proposal), root); const snapshot = existingSnapshot ?? await createProjectSnapshot(projectId, root, validated, rootIdentity, stateDirectory); if (snapshot.projectId !== projectId || snapshot.rootIdentity !== rootIdentity || snapshot.proposalHash !== hash(validated)) throw new ImplementationError("ERR_SNAPSHOT_PROJECT_MISMATCH", "The snapshot does not belong to this project and proposal."); const changedFiles = validated.files.map((file) => file.path);
  try {
    for (const file of validated.files) {
      if (file.action === "delete") throw new ImplementationError("ERR_PROPOSAL_INVALID", "Deletion is disabled by default in Stage 4.");
      const path = target(root, file.path); const current = projectFileHash(path); if (file.action === "modify" && current !== file.expectedBaseHash) throw new ImplementationError("ERR_TARGET_FILE_CHANGED", `Target changed since proposal creation: ${file.path}`); if (file.action === "create" && current !== undefined) throw new ImplementationError("ERR_TARGET_FILE_CHANGED", `Target already exists: ${file.path}`);
      const temp = `${path}.designflow-${snapshot.runId}.tmp`; await mkdir(dirname(path), { recursive: true }); await writeFile(temp, file.content ?? "", "utf8"); await rename(temp, path); const entry = snapshot.entries.find((candidate) => candidate.path === file.path); const writtenHash = projectFileHash(path); if (entry && writtenHash !== undefined) entry.postWriteHash = writtenHash;
    }
  } catch (error) { await rollbackProjectSnapshot(root, snapshot); throw error; }
  return { runId: snapshot.runId, projectId, proposalHash: snapshot.proposalHash, changedFiles, createdFiles: validated.files.filter((f) => f.action === "create").map((f) => f.path), modifiedFiles: validated.files.filter((f) => f.action === "modify").map((f) => f.path), snapshot };
}

export async function rollbackProjectSnapshot(root: string, snapshot: ProjectSnapshot, options: { force?: boolean } = {}): Promise<void> {
  if (snapshot.rootIdentity !== rootIdentityHash(root)) throw new ImplementationError("ERR_SNAPSHOT_PROJECT_MISMATCH", "The snapshot does not belong to this registered project.");
  for (const entry of snapshot.entries) { const path = target(root, entry.path); if (!options.force && entry.postWriteHash !== undefined && projectFileHash(path) !== entry.postWriteHash) throw new ImplementationError("ERR_ROLLBACK_EXTERNAL_CHANGE", `Rollback refused because ${entry.path} changed outside DesignFlow.`); if (entry.existed) { if (entry.content === undefined) throw new ImplementationError("ERR_ROLLBACK_FAILED", `Snapshot has no backup for ${entry.path}`); await mkdir(dirname(path), { recursive: true }); await writeFile(path, entry.content, "base64"); if (entry.mode !== undefined) await chmod(path, entry.mode); } else await rm(path, { force: true }); }
}
