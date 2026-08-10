import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { projectImplementationContextV1Schema, type Stage4ProjectImplementationContext } from "@designflow/sdk";
import { ImplementationError } from "./errors";

export interface InspectionLimits { maxFiles?: number; maxBytes?: number; maxFileBytes?: number; maxDepth?: number; }
const DEFAULTS: Required<InspectionLimits> = { maxFiles: 500, maxBytes: 2_000_000, maxFileBytes: 100_000, maxDepth: 8 };
const IGNORED = new Set([".git", "node_modules", "dist", "build", "out", "coverage", ".turbo", ".next", ".nuxt", ".svelte-kit", ".designflow"]);
const SECRET = /(^|\.)((env($|\.)|npmrc|pypirc|ssh|aws)|secret|credential|password|private[-_.]?key)|\.(pem|key|p12|pfx)$/i;
const SOURCE = /\.(tsx?|jsx?|vue|svelte|css|scss|sass|less|json)$/i;

function posix(path: string): string { return path.split(sep).join("/"); }
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function readText(path: string, max: number): string | undefined {
  try { const stat = lstatSync(path); if (!stat.isFile() || stat.size > max) return undefined; const data = readFileSync(path); if (data.subarray(0, Math.min(data.length, 512)).includes(0)) return undefined; return data.toString("utf8"); } catch { return undefined; }
}
function packageJson(root: string): Record<string, unknown> {
  const text = readText(join(root, "package.json"), 200_000); if (!text) return {};
  try { const value = JSON.parse(text); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; } catch { return {}; }
}
function deps(pkg: Record<string, unknown>): Record<string, string> { const read = (key: string) => { const value = pkg[key]; return value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {}; }; return { ...read("dependencies"), ...read("devDependencies"), ...read("peerDependencies") }; }
type PackageManager = "npm" | "bun" | "pnpm" | "yarn";

function command(name: "format"|"typecheck"|"lint"|"build"|"test"|"preview", script: unknown, required: boolean, packageManager: PackageManager, scriptName: string = name) {
  // Preserve the declaration, but never execute or parse its raw shell body.
  // The only safe invocation is the package manager plus this known script
  // name, which also supports compound scripts such as `node ... && tsc -b`.
  if (typeof script !== "string" || script.trim().length === 0) return undefined;
  const args = packageManager === "yarn" ? [name] : ["run", name];
  return { name, scriptName, executable: packageManager, args, source: "package-script" as const, required };
}

export function inspectRegisteredProject(project: { id: string; name: string; rootPath?: string }, limits: InspectionLimits = {}, signal?: AbortSignal): Stage4ProjectImplementationContext {
  if (!project.rootPath) throw new ImplementationError("ERR_PROJECT_NOT_REGISTERED", "A registered project is required before DesignFlow can generate or modify files.\n\nRun:\ndesignflow projects add");
  const opts = { ...DEFAULTS, ...limits };
  let root: string; try { root = realpathSync(project.rootPath); } catch { throw new ImplementationError("ERR_PROJECT_ROOT_INACCESSIBLE", "The registered project root could not be accessed."); }
  const files: string[] = [], warnings: { code: string; message: string; path?: string }[] = [], excerpts: Array<{path:string; text:string}> = [];
  let total = 0;
  const walk = (dir: string, depth: number) => {
    if (signal?.aborted) throw new ImplementationError("ERR_PROJECT_INSPECTION_ABORTED", "Project inspection was cancelled.");
    if (depth > opts.maxDepth) { warnings.push({ code: "DEPTH_LIMIT", message: `Inspection depth limit ${opts.maxDepth} reached.` }); return; }
    let names: string[]; try { names = readdirSync(dir).sort(); } catch { warnings.push({ code: "UNREADABLE_DIRECTORY", message: "A directory could not be read.", path: posix(relative(root, dir)) }); return; }
    for (const name of names) {
      if (files.length >= opts.maxFiles) { warnings.push({ code: "FILE_COUNT_LIMIT", message: `Inspection stopped at ${opts.maxFiles} files.` }); return; }
      if (IGNORED.has(name) || SECRET.test(name)) continue;
      const full = join(dir, name); let stat; try { stat = lstatSync(full); } catch { continue; }
      if (stat.isSymbolicLink()) { try { const target = realpathSync(full); if (!target.startsWith(root + sep) && target !== root) warnings.push({ code: "SYMLINK_SKIPPED", message: "Symlink outside the registered root was skipped.", path: posix(relative(root, full)) }); } catch { warnings.push({ code: "SYMLINK_SKIPPED", message: "Unreadable symlink was skipped.", path: posix(relative(root, full)) }); } continue; }
      const rel = posix(relative(root, full));
      if (stat.isDirectory()) { walk(full, depth + 1); continue; }
      if (!stat.isFile() || !SOURCE.test(name)) continue;
      if (stat.size > opts.maxFileBytes) { warnings.push({ code: "FILE_SIZE_LIMIT", message: `File exceeds ${opts.maxFileBytes} bytes and was skipped.`, path: rel }); continue; }
      if (total + stat.size > opts.maxBytes) { warnings.push({ code: "BYTE_LIMIT", message: `Inspection stopped at ${opts.maxBytes} bytes.` }); return; }
      total += stat.size; files.push(rel); const text = readText(full, opts.maxFileBytes); if (text && !SECRET.test(name)) { if (/(api[_-]?key|access[_-]?token|password|secret|private[_-]?key)\s*[:=]/i.test(text)) warnings.push({ code: "SUSPICIOUS_SECRET_CONTENT", message: "A file with suspicious secret-like content was excluded from model excerpts.", path: rel }); else excerpts.push({ path: rel, text }); }
    }
  };
  walk(root, 0);
  const pkg = packageJson(root), dependencies = deps(pkg), framework = dependencies.next ? "next" : dependencies.react ? "react" : dependencies.vue ? "vue" : dependencies.svelte ? "svelte" : dependencies["@angular/core"] ? "angular" : "unknown";
  const language = files.some((file) => /\.tsx?$/.test(file)) ? "typescript" : "javascript" as const;
  const sourceRoots = files.map((file) => file.split("/")[0]).filter((value, index, all) => value && all.indexOf(value) === index && ["src", "app", "source"].includes(value));
  const strategies = [...new Set(excerpts.flatMap(({ path, text }) => [
    ...(path.endsWith(".module.css") ? ["css-modules"] : []), ...(path.endsWith(".scss") || path.endsWith(".sass") ? ["sass"] : []), ...(text.includes("styled.") || text.includes("styled(") ? ["styled-components"] : []), ...(text.includes("@emotion/") ? ["emotion"] : []), ...(text.includes("className=") && text.includes("tailwind") ? ["tailwind"] : []), ...(text.includes("style={{") ? ["inline-styles"] : []), ...(path.endsWith(".css") ? ["css"] : []),
  ]))];
  const tokens = excerpts.flatMap(({path,text}) => [...text.matchAll(/--([A-Za-z0-9_-]+)\s*:\s*([^;\n]+)/g)].map((m) => ({ name: m[1]!, category: /color|background|foreground/i.test(m[1]!) ? "color" as const : /space|gap|padding|margin/i.test(m[1]!) ? "spacing" as const : /radius/i.test(m[1]!) ? "radii" as const : "motion" as const, reference: `var(--${m[1]})`, value: m[2]!.trim(), sourcePath: path })));
  const components = excerpts.filter(({path,text}) => /(^|\/)components\//.test(path) && /export\s+(default\s+)?(function|const|class)|<template/.test(text)).map(({path,text}) => { const names = [...text.matchAll(/export\s+(?:default\s+)?(?:function|const|class)\s+([A-Za-z0-9_]+)/g)].map((m) => m[1]!); return { name: names[0] ?? path.split("/").at(-1)!.split(".")[0]!, sourcePath: path, props: [...text.matchAll(/(?:interface|type)\s+\w*Props\s*\{([\s\S]*?)\}/g)].flatMap((m) => [...m[1]!.matchAll(/(\w+)\??\s*:/g)].map((p) => ({ name: p[1]! }))), variants: [], styling: strategies[0], safeToReuse: true, evidence: [`component source: ${path}`] }; });
  const scripts = pkg.scripts && typeof pkg.scripts === "object" && !Array.isArray(pkg.scripts) ? pkg.scripts as Record<string, unknown> : {};
  const packageManager: PackageManager = lstatSync(join(root, "bun.lock"), { throwIfNoEntry: false }) || lstatSync(join(root, "bun.lockb"), { throwIfNoEntry: false }) ? "bun" : lstatSync(join(root, "pnpm-lock.yaml"), { throwIfNoEntry: false }) ? "pnpm" : lstatSync(join(root, "yarn.lock"), { throwIfNoEntry: false }) ? "yarn" : "npm";
  const previewScriptName = typeof scripts.preview === "string" ? "preview" : typeof scripts.dev === "string" ? "dev" : typeof scripts.start === "string" ? "start" : "serve";
  const previewScript = scripts.preview ?? scripts.dev ?? scripts.start ?? scripts.serve;
  const commands = { format: command("format", scripts.format, false, packageManager), typecheck: command("typecheck", scripts.typecheck, true, packageManager), lint: command("lint", scripts.lint, true, packageManager), build: command("build", scripts.build, true, packageManager), test: command("test", scripts.test, false, packageManager), preview: command("preview", previewScript, false, packageManager, previewScriptName) };
  const contextBase = { schemaVersion: "1" as const, project: { id: project.id, rootIdentity: hash(root), contextFingerprint: "pending" }, runtime: { framework, ...(dependencies[framework] ? { frameworkVersion: dependencies[framework] } : {}), language, packageManager, monorepo: Boolean(pkg.workspaces), dependencies: Object.keys(dependencies).sort().slice(0, 200) }, structure: { sourceRoots: [...new Set(sourceRoots)].sort(), routeRoots: files.filter((file) => /routes?|pages?|app\//.test(file)).map((file) => file.split("/").slice(0, -1).join("/")).filter((v,i,a)=>v&&a.indexOf(v)===i).sort(), publicAssetRoots: files.filter((file) => /^(public|static|assets)\//.test(file)).map((file)=>file.split("/")[0]).filter((v,i,a)=>a.indexOf(v)===i).sort(), aliases: {} }, styling: { strategies: strategies.length ? strategies : ["unknown"], ...(strategies[0] ? { primaryStrategy: strategies[0] } : {}), evidence: strategies }, designSystem: { tokenSources: tokens.length ? [{ path: tokens[0]!.sourcePath, kind: "css-variables", evidence: ["CSS custom properties detected"] }] : [], tokens, componentSources: components.map((component) => ({ path: component.sourcePath, exportedNames: [component.name] })), components }, conventions: { naming: ["component names are PascalCase when exported"], fileLayout: sourceRoots.length ? [`source files live under ${sourceRoots[0]}`] : [], exports: ["preserve existing export style"], props: ["reuse existing prop types when present"], testing: files.some((file)=>/\.test\.|\.spec\./.test(file)) ? ["tests are colocated"] : [], accessibility: ["preserve semantic roles and accessible names"] }, commands, warnings };
  const fingerprint = hash(JSON.stringify({ files, excerpts: excerpts.map((entry) => ({ path: entry.path, hash: hash(entry.text) })), pkg }));
  return projectImplementationContextV1Schema.parse({ ...contextBase, project: { ...contextBase.project, contextFingerprint: fingerprint } });
}
