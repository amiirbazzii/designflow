// packages/tools/src/project-context/alias-inspector.ts
//
// Deterministic path-alias discovery.
//
// The Stage-4 inspector shipped `structure.aliases = {}` — hardcoded — so a
// project declaring `@/*  →  ./src/*` looked, to everything downstream, like
// a project with no aliases at all. An implementation that then writes
// `import { Button } from "../../components/ui/button"` is not wrong, but it
// is not what the codebase does, which is exactly the kind of mismatch that
// makes generated code read as foreign.
//
// Reads only declarations: `compilerOptions.baseUrl` and
// `compilerOptions.paths` from `tsconfig.json` / `jsconfig.json`, following
// `extends` with a bounded depth and cycle detection. Nothing is executed and
// no module resolution is simulated — a declared alias whose target does not
// exist on disk stays visible with an empty `resolvedTargets`, because
// "declared but missing" is a fact worth knowing.
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import type { ProjectAlias, ProjectProvenance } from "@designflow/sdk";

/** Config inheritance is bounded; a real project never needs more. */
export const MAX_EXTENDS_DEPTH = 8;
const MAX_CONFIG_BYTES = 1_000_000;

export interface AliasInspection {
  readonly aliases: readonly ProjectAlias[];
  readonly baseUrl?: { readonly value: string; readonly provenance: ProjectProvenance };
  /** Config files actually read, project-relative, in resolution order. */
  readonly configPaths: readonly string[];
  readonly warnings: readonly { readonly code: string; readonly message: string; readonly path?: string }[];
}

function posix(path: string): string {
  return path.split(sep).join("/");
}

/**
 * Reads one JSON config, tolerating the comments and trailing commas real
 * `tsconfig.json` files carry (JSON5-ish in practice, and `JSON.parse` alone
 * rejects the majority of real Next/Vite configs).
 */
function readJsonConfig(path: string): Record<string, unknown> | undefined {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > MAX_CONFIG_BYTES) return undefined;
    const raw = readFileSync(path, "utf8");
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"'\\])\/\/.*$/gm, "$1")
      .replace(/,(\s*[}\]])/g, "$1");
    const parsed: unknown = JSON.parse(stripped);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function compilerOptions(config: Record<string, unknown>): Record<string, unknown> {
  const options = config["compilerOptions"];
  return typeof options === "object" && options !== null && !Array.isArray(options)
    ? (options as Record<string, unknown>)
    : {};
}

/** Resolves an `extends` entry to a real config path, bounded to the project. */
function resolveExtends(entry: string, fromDir: string, root: string): string | undefined {
  const candidate = entry.startsWith(".") || isAbsolute(entry)
    ? resolve(fromDir, entry)
    : resolve(root, "node_modules", entry);
  for (const path of [candidate, `${candidate}.json`, join(candidate, "tsconfig.json")]) {
    try {
      if (lstatSync(path).isFile()) return path;
    } catch {
      continue;
    }
  }
  return undefined;
}

/**
 * Collects alias declarations for one project root.
 *
 * `tsconfig.json` wins over `jsconfig.json` when both exist — TypeScript
 * ignores `jsconfig.json` entirely in that case, and the context must
 * describe what the project's own tooling does.
 */
export function inspectProjectAliases(root: string): AliasInspection {
  const warnings: { code: string; message: string; path?: string }[] = [];
  const configPaths: string[] = [];

  const entry = ["tsconfig.json", "jsconfig.json"]
    .map((name) => join(root, name))
    .find((path) => existsSync(path));
  if (entry === undefined) return { aliases: [], configPaths: [], warnings };

  const isJsConfig = entry.endsWith("jsconfig.json");
  const source = isJsConfig ? ("jsconfig" as const) : ("tsconfig" as const);

  // Walk the extends chain from the entry outward, recording each config once.
  const chain: { path: string; options: Record<string, unknown> }[] = [];
  const seen = new Set<string>();
  let current: string | undefined = entry;
  let depth = 0;

  while (current !== undefined) {
    if (seen.has(current)) {
      warnings.push({ code: "TSCONFIG_EXTENDS_CYCLE", message: "A tsconfig `extends` chain referenced itself and was stopped.", path: posix(relative(root, current)) });
      break;
    }
    if (depth >= MAX_EXTENDS_DEPTH) {
      warnings.push({ code: "TSCONFIG_EXTENDS_DEPTH", message: `Config inheritance stopped at ${MAX_EXTENDS_DEPTH} levels.`, path: posix(relative(root, current)) });
      break;
    }
    seen.add(current);
    const config = readJsonConfig(current);
    if (config === undefined) {
      warnings.push({ code: "TSCONFIG_UNREADABLE", message: "A TypeScript/JavaScript config could not be read.", path: posix(relative(root, current)) });
      break;
    }
    chain.push({ path: current, options: compilerOptions(config) });
    configPaths.push(posix(relative(root, current)));

    const extendsEntry = config["extends"];
    // Only the single-string form: the array form is TS 5.x and rare, and
    // guessing merge order for it would be worse than reporting nothing.
    if (typeof extendsEntry !== "string" || extendsEntry.length === 0) break;
    const next = resolveExtends(extendsEntry, dirname(current), root);
    if (next === undefined) {
      warnings.push({ code: "TSCONFIG_EXTENDS_MISSING", message: "A config `extends` target could not be resolved.", path: posix(relative(root, current)) });
      break;
    }
    current = next;
    depth += 1;
  }

  // Nearest config wins: the entry config's own options override inherited ones.
  const effective = [...chain].reverse().reduce<{ baseUrl?: { value: string; path: string }; paths?: { value: Record<string, unknown>; path: string } }>(
    (accumulated, { path, options }) => {
      const baseUrl = options["baseUrl"];
      if (typeof baseUrl === "string" && baseUrl.length > 0) accumulated.baseUrl = { value: baseUrl, path };
      const paths = options["paths"];
      if (typeof paths === "object" && paths !== null && !Array.isArray(paths)) {
        accumulated.paths = { value: paths as Record<string, unknown>, path };
      }
      return accumulated;
    },
    {},
  );

  const baseUrlDir = effective.baseUrl === undefined
    ? root
    : resolve(dirname(effective.baseUrl.path), effective.baseUrl.value);

  const aliases: ProjectAlias[] = [];
  for (const [pattern, rawTargets] of Object.entries(effective.paths?.value ?? {})) {
    if (!Array.isArray(rawTargets)) continue;
    const targets = rawTargets.filter((target): target is string => typeof target === "string" && target.length > 0).slice(0, 16);
    const resolvedTargets: string[] = [];
    for (const target of targets) {
      // The wildcard is a literal in the declaration; resolution only checks
      // the fixed prefix, so `@/*` → `./src/*` resolves against `src/`.
      const fixed = target.replace(/\*.*$/, "");
      const absolute = resolve(baseUrlDir, fixed);
      if (!absolute.startsWith(root + sep) && absolute !== root) continue;
      if (existsSync(absolute)) resolvedTargets.push(posix(relative(root, normalize(absolute))) || ".");
    }
    aliases.push({
      pattern,
      targets,
      resolvedTargets,
      provenance: {
        source,
        path: posix(relative(root, effective.paths?.path ?? entry)),
        confidence: "deterministic",
      },
    });
  }

  aliases.sort((left, right) => left.pattern.localeCompare(right.pattern));

  return {
    aliases,
    ...(effective.baseUrl !== undefined
      ? {
          baseUrl: {
            value: posix(relative(root, baseUrlDir)) || ".",
            provenance: { source, path: posix(relative(root, effective.baseUrl.path)), confidence: "deterministic" as const },
          },
        }
      : {}),
    configPaths,
    warnings,
  };
}
