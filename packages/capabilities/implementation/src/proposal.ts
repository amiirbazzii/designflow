import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, normalize, sep } from "node:path";
import { proposedFileChangesSchema, type ProposedFileChanges } from "@designflow/sdk";
import { ImplementationError } from "./errors";

const FORBIDDEN = /^(?:\.git|node_modules|\.designflow|\.env(?:\.|$)|.*(?:secret|credential|private[-_.]?key))/i;
const SUPPORTED = /\.(?:tsx?|jsx?|vue|svelte|css|scss|sass|less|json|md)$/i;
export function projectFileHash(path: string): string | undefined { try { return createHash("sha256").update(readFileSync(path).toString("base64")).digest("hex"); } catch { return undefined; } }
export function validateProposedFileChanges(proposal: ProposedFileChanges, root: string, limits = { maxFileBytes: 500_000, maxTotalBytes: 2_000_000 }): ProposedFileChanges {
  const parsed = proposedFileChangesSchema.parse(proposal); let total = 0; const paths = new Set<string>();
  let canonicalRoot: string; try { canonicalRoot = realpathSync(root); } catch { throw new ImplementationError("ERR_PROJECT_ROOT_INACCESSIBLE", "The registered project root could not be accessed."); }
  for (const file of parsed.files) {
    if (isAbsolute(file.path) || file.path.includes("\\") || normalize(file.path).startsWith("..")) throw new ImplementationError("ERR_UNSAFE_PATH", `Unsafe project path: ${file.path}`);
    const normalized = normalize(file.path).split(sep).join("/"); if (normalized !== file.path || normalized.split("/").some((part) => part === "..") || FORBIDDEN.test(normalized)) throw new ImplementationError("ERR_PATH_TRAVERSAL", `Project path is outside the allowed source boundary: ${file.path}`);
    if (!SUPPORTED.test(normalized)) throw new ImplementationError("ERR_UNSUPPORTED_FILE_TYPE", `Unsupported project file type: ${file.path}`);
    if (paths.has(normalized)) throw new ImplementationError("ERR_DUPLICATE_PROPOSAL_ACTION", `Duplicate proposal action: ${file.path}`); paths.add(normalized);
    if (file.action === "modify" && !file.expectedBaseHash) throw new ImplementationError("ERR_TARGET_FILE_CHANGED", `Modified file lacks an expected base hash: ${file.path}`);
    if ((file.action === "create" || file.action === "modify") && file.content === undefined && file.patch === undefined) throw new ImplementationError("ERR_PROPOSAL_INVALID", `File proposal has no content or patch: ${file.path}`);
    const bytes = Buffer.byteLength(file.content ?? file.patch ?? ""); total += bytes; if (bytes > limits.maxFileBytes) throw new ImplementationError("ERR_PROPOSAL_TOO_LARGE", `Proposed file exceeds ${limits.maxFileBytes} bytes: ${file.path}`);
    if (total > limits.maxTotalBytes) throw new ImplementationError("ERR_PROPOSAL_TOO_LARGE", `Proposed changes exceed ${limits.maxTotalBytes} bytes.`);
    const target = normalize(`${canonicalRoot}/${normalized}`); if (!target.startsWith(canonicalRoot + sep)) throw new ImplementationError("ERR_UNSAFE_PATH", `Target escapes registered project: ${file.path}`);
    try { if (lstatSync(target).isSymbolicLink() || realpathSync(target) !== target) throw new ImplementationError("ERR_SYMLINK_ESCAPE", `Symlink target is not writable: ${file.path}`); } catch (error) { if (error instanceof ImplementationError) throw error; }
  }
  return parsed;
}
