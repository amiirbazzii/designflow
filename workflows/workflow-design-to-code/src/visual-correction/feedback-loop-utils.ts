import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join, normalize, relative, sep } from "node:path";
import { correctionAgentOutputV1Schema, proposedCorrectionChangeV1Schema, type CorrectionAgentOutputV1, type CorrectionContextV1 } from "@designflow/sdk";
import { proposedCorrectionChangesSchema, type FeedbackLoopWorkflowInput } from "./feedback-loop-types";

export const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
export const objectHash = (value: unknown): string => sha256(JSON.stringify(value));

const SECRET_PATH = /(^|\/)(\.env(?:\.|$)|\.npmrc|\.pypirc|\.ssh|\.aws|secrets?|credentials?|private[-_.]?key)(\/|$)|\.(pem|key|p12|pfx)$/i;

export function safeProjectPath(root: string, path: string): string {
  if (!path || path.startsWith("/") || path.includes("\\") || path.split("/").includes("..") || SECRET_PATH.test(path)) throw new Error(`Correction path is outside the approved source scope: ${path}`);
  const resolved = normalize(join(root, path));
  const rel = relative(normalize(root), resolved);
  if (rel.startsWith(`..${sep}`) || rel === ".." || rel === "") throw new Error(`Correction path escapes the registered project: ${path}`);
  const stat = lstatSync(resolved, { throwIfNoEntry: false });
  if (stat?.isSymbolicLink()) throw new Error(`Symlink correction targets are not permitted: ${path}`);
  return resolved;
}

export function readBoundedExcerpt(root: string, path: string, maxBytes = 50_000): { path: string; content: string; hash: string } {
  const full = safeProjectPath(root, path);
  const stat = lstatSync(full, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.size > maxBytes) throw new Error(`Correction target is not a bounded text file: ${path}`);
  const bytes = readFileSync(full);
  if (bytes.includes(0)) throw new Error(`Binary correction targets are not permitted: ${path}`);
  const content = bytes.toString("utf8");
  // Stage 4's scoped application service hashes the base file's base64
  // representation. Reuse that exact identity at the proposal boundary so a
  // correction cannot pass planning and fail only after approval.
  return { path, content, hash: sha256(bytes.toString("base64")) };
}

export function validateCorrectionAgentOutput(raw: unknown, context: CorrectionContextV1, input: FeedbackLoopWorkflowInput): CorrectionAgentOutputV1 {
  const output = correctionAgentOutputV1Schema.parse(raw);
  const findingIds = new Set(context.selectedFindings.map((finding) => finding.findingId));
  const evidenceIds = new Set(context.evidenceReferences.map((evidence) => evidence.artifactId));
  const allowed = new Set(context.allowedFileScope);
  if (output.plan.iterationNumber !== context.iterationNumber) throw new Error("Correction plan iteration does not match the current iteration.");
  if (output.plan.selectedFindingIds.some((id) => !findingIds.has(id)) || output.plan.selectedFindingIds.length !== findingIds.size) throw new Error("Correction proposal addresses an unknown or omitted finding.");
  if (output.changes.length === 0 || output.changes.length > input.iterationPolicy.maxFilesPerIteration) throw new Error("Correction proposal exceeds the file limit or is empty.");
  if (output.changes.some((change) => !allowed.has(change.relativePath))) throw new Error("Correction proposal widens the approved file scope.");
  if (output.changes.some((change) => change.findingIds.some((id) => !findingIds.has(id)) || change.evidenceIds.some((id) => !evidenceIds.has(id) && !id.startsWith("specification:")))) throw new Error("Correction proposal contains unknown finding or evidence ids.");
  if (output.changes.some((change) => change.operation === "delete" || change.dependencyChangeRequired)) throw new Error("Deletion and dependency changes are disabled for the default correction policy.");
  const excerpts = new Map(context.currentImplementationExcerpts.map((excerpt) => [excerpt.path, excerpt]));
  let bytes = 0;
  for (const change of output.changes) {
    const excerpt = excerpts.get(change.relativePath);
    if (!excerpt || change.baseFileHash !== excerpt.hash || change.proposedContent === undefined || change.proposedContentHash !== sha256(change.proposedContent)) throw new Error(`Correction proposal is stale or has an invalid content hash for ${change.relativePath}.`);
    bytes += Buffer.byteLength(change.proposedContent, "utf8");
  }
  if (bytes > input.iterationPolicy.maxChangedBytesPerIteration) throw new Error("Correction proposal exceeds the changed-byte limit.");
  for (const mapping of output.plan.findingToChangeMapping) {
    if (!findingIds.has(mapping.findingId) || mapping.changeIndexes.some((index) => index < 0 || index >= output.changes.length) || mapping.evidenceIds.some((id) => !evidenceIds.has(id) && !id.startsWith("specification:"))) throw new Error(`Correction mapping for ${mapping.findingId} is invalid.`);
  }
  const parsedChanges = output.changes.map((change) => proposedCorrectionChangeV1Schema.parse(change));
  proposedCorrectionChangesSchema.parse({ schemaVersion: "1", changes: parsedChanges, contentHash: objectHash(parsedChanges), totalBytes: bytes, dependencyCount: 0 });
  return output;
}

export function correctionToImplementationProposal(projectId: string, baseProjectFingerprint: string, output: CorrectionAgentOutputV1) {
  return { schemaVersion: "1" as const, projectId, baseProjectFingerprint, files: output.changes.map((change) => ({ path: change.relativePath, action: change.operation, content: change.proposedContent, expectedBaseHash: change.baseFileHash, reason: change.reason, relatedDesignNodeIds: change.findingIds })), packageChanges: [], commandsRequested: [], assumptions: [], unresolvedItems: [] };
}
