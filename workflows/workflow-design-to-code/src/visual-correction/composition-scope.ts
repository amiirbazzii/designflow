import { lstatSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { MAX_CORRECTION_COMPOSITION_FILES, type CompositionScopeEntry } from "@designflow/sdk";
import { safeProjectPath } from "../visual-correction/feedback-loop-utils";

const SOURCE_EXTENSIONS = [".jsx", ".tsx", ".js", ".ts", ".mjs", ".vue", ".svelte"] as const;
const NON_COMPONENT_IMPORT = /\.(css|scss|sass|less|json|svg|png|jpe?g|gif|webp|ico|woff2?)$/i;

/**
 * Reads a bounded UTF-8 text file at a project-relative path, returning
 * undefined for anything unsafe, missing, binary, or oversized. Never throws.
 */
function readProjectText(root: string, path: string, maxBytes = 100_000): string | undefined {
  try {
    const full = safeProjectPath(root, path);
    const stat = lstatSync(full, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.size > maxBytes) return undefined;
    const bytes = readFileSync(full);
    if (bytes.includes(0)) return undefined;
    return bytes.toString("utf8");
  } catch {
    return undefined;
  }
}

function isProjectFile(root: string, path: string): boolean {
  try {
    const stat = lstatSync(safeProjectPath(root, path), { throwIfNoEntry: false });
    return stat?.isFile() === true;
  } catch {
    return false;
  }
}

/** Finds the module entry referenced by the preview's index.html, e.g. `src/main.jsx`. */
function previewEntryPath(root: string): string | undefined {
  const html = readProjectText(root, "index.html");
  if (html === undefined) return undefined;
  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
    if (!/\btype\s*=\s*["']module["']/i.test(tag)) continue;
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (src === undefined || /^[a-z][a-z0-9+.-]*:|^\/\//i.test(src)) continue;
    const path = posix.normalize(src.replace(/^\.?\//, ""));
    if (isProjectFile(root, path)) return path;
  }
  return undefined;
}

/** Resolves one relative import specifier from `fromFile` to an existing project source file. */
function resolveRelativeImport(root: string, fromFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return undefined;
  if (NON_COMPONENT_IMPORT.test(specifier)) return undefined;
  const base = posix.normalize(posix.join(posix.dirname(fromFile), specifier));
  if (base.startsWith("..")) return undefined;
  const candidates = SOURCE_EXTENSIONS.some((extension) => base.endsWith(extension))
    ? [base]
    : [...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`), ...SOURCE_EXTENSIONS.map((extension) => `${base}/index${extension}`)];
  return candidates.find((candidate) => isProjectFile(root, candidate));
}

function staticImportSpecifiers(content: string): string[] {
  return [...content.matchAll(/import\s+(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/g)].map((match) => match[1]!);
}

/**
 * Derives the bounded, host-authorized composition scope for a root-frame
 * visual finding: the preview entry module referenced by index.html plus the
 * root components that entry statically imports. The result is capped at
 * MAX_CORRECTION_COMPOSITION_FILES using a documented precedence — the entry
 * first, then imports in entry-source order — and fails closed (empty) when
 * the render path cannot be resolved deterministically. The model never
 * chooses or extends this set.
 */
export interface RenderReachability {
  /** Present when the preview entry could be resolved deterministically. */
  readonly previewEntry?: string;
  readonly reachableChangedFiles: readonly string[];
  readonly unreachableChangedFiles: readonly string[];
}

const MAX_REACHABILITY_MODULES = 500;

/**
 * Determines, by bounded static-import traversal from the preview entry,
 * which changed executable files are currently part of the rendered module
 * graph. Unreachability is evidence for the correction stage, never an
 * error by itself; with no resolvable entry every changed file is honestly
 * reported unreachable.
 */
export function analyzeRenderReachability(root: string, changedFiles: readonly string[]): RenderReachability {
  const entry = previewEntryPath(root);
  if (entry === undefined) return { reachableChangedFiles: [], unreachableChangedFiles: [...changedFiles] };
  const visited = new Set<string>([entry]);
  const queue = [entry];
  while (queue.length > 0 && visited.size < MAX_REACHABILITY_MODULES) {
    const current = queue.shift()!;
    const content = readProjectText(root, current);
    if (content === undefined) continue;
    for (const specifier of staticImportSpecifiers(content)) {
      const resolved = resolveRelativeImport(root, current, specifier);
      if (resolved !== undefined && !visited.has(resolved)) {
        visited.add(resolved);
        queue.push(resolved);
      }
    }
  }
  return {
    previewEntry: entry,
    reachableChangedFiles: changedFiles.filter((file) => visited.has(file)),
    unreachableChangedFiles: changedFiles.filter((file) => !visited.has(file)),
  };
}

export function deriveCompositionScope(root: string): CompositionScopeEntry[] {
  const entry = previewEntryPath(root);
  if (entry === undefined) return [];
  const content = readProjectText(root, entry);
  if (content === undefined) return [];
  const source = "deterministic-project-inspection" as const;
  const entries: CompositionScopeEntry[] = [{ path: entry, reason: "preview entry module referenced by index.html", source }];
  for (const specifier of staticImportSpecifiers(content)) {
    const resolved = resolveRelativeImport(root, entry, specifier);
    if (resolved !== undefined && !entries.some((candidate) => candidate.path === resolved))
      entries.push({ path: resolved, reason: `root component imported by application entry ${entry}`, source });
  }
  return entries.slice(0, MAX_CORRECTION_COMPOSITION_FILES);
}
