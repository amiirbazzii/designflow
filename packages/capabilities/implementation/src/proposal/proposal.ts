import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, normalize, sep } from "node:path";
import { proposedFileChangesSchema, type ProposedFileChanges } from "@designflow/sdk";
import { ImplementationError } from "./errors";
import { isExecutableSourcePath } from "./proposed-state-validation";

const FORBIDDEN = /^(?:\.git|node_modules|\.designflow|\.env(?:\.|$)|.*(?:secret|credential|private[-_.]?key))/i;
const SUPPORTED = /\.(?:tsx?|jsx?|vue|svelte|css|scss|sass|less|json|md)$/i;
export function projectFileHash(path: string): string | undefined { try { return createHash("sha256").update(readFileSync(path).toString("base64")).digest("hex"); } catch { return undefined; } }
export interface ProposalValidationOptions {
  /**
   * Whether `modify`/`delete` targets must exist and `create` targets must
   * not. On by default — this is the pre-approval integrity gate. Apply-time
   * callers disable it because a resumed partial apply legitimately finds
   * its own already-written files; apply enforces staleness per file against
   * the snapshot instead.
   */
  readonly checkTargetExistence?: boolean;
}
export function validateProposedFileChanges(proposal: ProposedFileChanges, root: string, limits = { maxFileBytes: 500_000, maxTotalBytes: 2_000_000 }, options: ProposalValidationOptions = {}): ProposedFileChanges {
  const checkTargetExistence = options.checkTargetExistence !== false;
  const parsed = proposedFileChangesSchema.parse(proposal); let total = 0; const paths = new Set<string>();
  let canonicalRoot: string; try { canonicalRoot = realpathSync(root); } catch { throw new ImplementationError("ERR_PROJECT_ROOT_INACCESSIBLE", "The registered project root could not be accessed."); }
  for (const file of parsed.files) {
    if (isAbsolute(file.path) || file.path.includes("\\") || normalize(file.path).startsWith("..")) throw new ImplementationError("ERR_UNSAFE_PATH", `Unsafe project path: ${file.path}`);
    const normalized = normalize(file.path).split(sep).join("/"); if (normalized !== file.path || normalized.split("/").some((part) => part === "..") || FORBIDDEN.test(normalized)) throw new ImplementationError("ERR_PATH_TRAVERSAL", `Project path is outside the allowed source boundary: ${file.path}`);
    if (!SUPPORTED.test(normalized)) throw new ImplementationError("ERR_UNSUPPORTED_FILE_TYPE", `Unsupported project file type: ${file.path}`);
    if (paths.has(normalized)) throw new ImplementationError("ERR_DUPLICATE_PROPOSAL_ACTION", `Duplicate proposal action: ${file.path}`); paths.add(normalized);
    const target = normalize(`${canonicalRoot}/${normalized}`); if (!target.startsWith(canonicalRoot + sep)) throw new ImplementationError("ERR_UNSAFE_PATH", `Target escapes registered project: ${file.path}`);
    // Operation semantics are validated against the real baseline, not
    // trusted from the model: a `modify`/`delete` needs an existing regular
    // file and a `create` needs a vacant path. This runs at proposal time —
    // before the approval prompt — so an impossible operation can never be
    // presented as approvable. It precedes the base-hash requirement so a
    // nonexistent modify target is diagnosed as the missing file it is.
    if (checkTargetExistence) {
      const exists = ((): boolean => { try { return lstatSync(target).isFile(); } catch { return false; } })();
      if ((file.action === "modify" || file.action === "delete") && !exists) throw new ImplementationError("ERR_PROPOSAL_TARGET_MISSING", `Proposed ${file.action} targets a file that does not exist in the project: ${file.path}`, { path: file.path, operation: file.action, fact: "target does not exist as a regular file" });
      if (file.action === "create" && exists) throw new ImplementationError("ERR_PROPOSAL_TARGET_EXISTS", `Proposed create targets a file that already exists in the project: ${file.path}`, { path: file.path, operation: file.action, fact: "target already exists as a regular file" });
    }
    if (file.action === "modify" && !file.expectedBaseHash) throw new ImplementationError("ERR_TARGET_FILE_CHANGED", `Modified file lacks an expected base hash: ${file.path}`);
    if ((file.action === "create" || file.action === "modify") && file.content === undefined && file.patch === undefined) throw new ImplementationError("ERR_PROPOSAL_INVALID", `File proposal has no content or patch: ${file.path}`, { path: file.path, operation: file.action, fact: "create/modify actions require content or a patch" });
    // Content integrity for executable sources: empty/whitespace-only content
    // is a destructive no-op that would blank (or create) a module the rest
    // of the pipeline can only judge syntactically — an empty module compiles.
    // There is deliberately NO minimum-length rule: `export {};` is valid.
    if ((file.action === "create" || file.action === "modify") && isExecutableSourcePath(normalized) && file.content !== undefined && file.content.trim().length === 0) throw new ImplementationError("ERR_PROPOSAL_EMPTY_EXECUTABLE_CONTENT", `Executable source proposals must contain non-whitespace source content: ${file.path}`, { path: file.path, operation: file.action, fact: "executable source proposals must contain non-whitespace source content" });
    // A modify whose proposed bytes equal the current trusted bytes changes
    // nothing and must not consume an approval. Exact equality only — a
    // formatting-only change that alters bytes is a real proposal. Skipped
    // when existence checks are off (apply-time revalidation of a resumed
    // partial apply legitimately sees its own already-written content).
    if (checkTargetExistence && file.action === "modify" && file.content !== undefined) {
      const current = ((): string | undefined => { try { return readFileSync(target, "utf8"); } catch { return undefined; } })();
      if (current !== undefined && current === file.content) throw new ImplementationError("ERR_PROPOSAL_NOOP_MODIFY", `Proposed modify content is identical to the current file: ${file.path}`, { path: file.path, operation: file.action, fact: "proposed modify content is identical to the current file" });
    }
    const bytes = Buffer.byteLength(file.content ?? file.patch ?? ""); total += bytes; if (bytes > limits.maxFileBytes) throw new ImplementationError("ERR_PROPOSAL_TOO_LARGE", `Proposed file exceeds ${limits.maxFileBytes} bytes: ${file.path}`);
    if (total > limits.maxTotalBytes) throw new ImplementationError("ERR_PROPOSAL_TOO_LARGE", `Proposed changes exceed ${limits.maxTotalBytes} bytes.`);
    try { if (lstatSync(target).isSymbolicLink() || realpathSync(target) !== target) throw new ImplementationError("ERR_SYMLINK_ESCAPE", `Symlink target is not writable: ${file.path}`); } catch (error) { if (error instanceof ImplementationError) throw error; }
  }
  return parsed;
}
