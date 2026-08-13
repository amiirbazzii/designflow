// packages/tools/src/project-context/project-context-compiler.ts
//
// The deterministic Project Context compiler (Agent Architecture V2, V2-2).
//
//   project filesystem
//        ↓  inspectProjectDirectory   (existing tools inspector)
//        ↓  inspectProjectAliases     (this module)
//        ↓  Stage-4 implementation context, when the caller already has one
//   compileProjectContext  ← here
//        ↓
//   CanonicalProjectContext
//
// Zero model calls, by construction: this package depends on `@designflow/sdk`
// and nothing else. Same project on disk in, structurally identical context
// out — the only volatile input is the caller-supplied project id.
//
// It answers *what the project is*. Which component to reuse, what to create,
// and where a screen should live are decisions, and decisions belong to the
// Project Mapper (V2-3).
import {
  canonicalProjectContextSchema,
  CANONICAL_PROJECT_CONTEXT_SCHEMA_VERSION,
  type CanonicalProjectContext,
  type ProjectAlias,
  type ProjectBound,
  type ProjectComponent,
  type ProjectDestination,
  type ProjectProvenance,
  type Stage4ProjectImplementationContext,
} from "@designflow/sdk";

import {
  dependencyNames,
  detectDesignSystemPackage,
  inspectProjectDirectory,
  readPackageManifest,
  MAX_ENTRIES,
  MAX_REPORTED_FILES,
  type ProjectInspectionRaw,
} from "../catalog/project-inspection";
import { inspectProjectAliases } from "./alias-inspector";

export const PROJECT_CONTEXT_COMPILER_VERSION = "1";

/** Component inventory bound. Reached only by large projects; always reported. */
export const MAX_COMPONENT_INVENTORY = 200;
export const MAX_DESTINATIONS = 40;

export interface CompileProjectContextOptions {
  readonly root: string;
  readonly projectId?: string;
  /**
   * The Stage-4 implementation context, when the caller already compiled one.
   *
   * Adapter rather than dependency: that inspector lives in
   * `@designflow/capability-implementation`, and importing it here would make
   * the tools package depend on a capability package for facts the caller
   * already has. Absent, the context simply carries less.
   */
  readonly implementationContext?: Stage4ProjectImplementationContext;
  readonly signal?: AbortSignal;
}

const deterministic = (source: ProjectProvenance["source"], path?: string): ProjectProvenance => ({
  source,
  ...(path !== undefined ? { path } : {}),
  confidence: "deterministic",
});

const heuristic = (source: ProjectProvenance["source"], path?: string): ProjectProvenance => ({
  source,
  ...(path !== undefined ? { path } : {}),
  confidence: "heuristic",
});

/** `next` → `next-app-router` requires evidence of the `app/` convention. */
function detectRouting(
  raw: ProjectInspectionRaw,
  framework: string | undefined,
  dependencies: readonly string[],
): CanonicalProjectContext["routing"] {
  const files = raw.relevantFiles;
  const hasAppRoute = files.some((file) => /(^|\/)app\/.*\/?(page|layout)\.(tsx?|jsx?)$/.test(file));
  const hasPagesRoute = files.some((file) => /(^|\/)pages\/.*\.(tsx?|jsx?)$/.test(file));

  if (framework === "next" || framework === "nextjs") {
    if (hasAppRoute) {
      return { kind: "next-app-router", provenance: deterministic("route_convention"), routeFileConvention: "app/**/page.tsx" };
    }
    if (hasPagesRoute) {
      return { kind: "next-pages-router", provenance: deterministic("route_convention"), routeFileConvention: "pages/**/*.tsx" };
    }
    return { kind: "unknown" };
  }
  // A declared router dependency is deterministic evidence; a file merely
  // named "router" is not, and guessing from names is how a project without a
  // router acquires one.
  if (dependencies.includes("react-router-dom") || dependencies.includes("react-router")) {
    return { kind: "react-router", provenance: deterministic("package_manifest", "package.json"), routeFileConvention: "<Route path=…>" };
  }
  if (dependencies.includes("vue-router")) {
    return { kind: "vue-router", provenance: deterministic("package_manifest", "package.json") };
  }
  if (dependencies.includes("@sveltejs/kit")) {
    return { kind: "svelte-kit", provenance: deterministic("package_manifest", "package.json") };
  }
  return { kind: "unknown" };
}

/** Composition roots: the file that makes a generated screen reachable. */
function compositionRoots(files: readonly string[]): readonly string[] {
  return files.filter((file) =>
    /(^|\/)(App|app|main|index|_app|layout)\.(tsx|ts|jsx|js|vue|svelte)$/.test(file) ||
    /(^|\/)app\/layout\.(tsx?|jsx?)$/.test(file),
  );
}

function destinationsFrom(
  raw: ProjectInspectionRaw,
  routingKind: CanonicalProjectContext["routing"]["kind"],
): { destinations: ProjectDestination[]; bound?: ProjectBound } {
  const destinations: ProjectDestination[] = [];

  for (const candidate of raw.destinations) {
    if (candidate.kind === "page") {
      destinations.push({
        path: candidate.sourcePath,
        kind: "page",
        route: candidate.label,
        status: "existing",
        provenance: deterministic("route_convention", candidate.sourcePath),
      });
    } else {
      destinations.push({
        path: candidate.sourcePath,
        kind: "component",
        status: "existing",
        provenance: deterministic("filesystem", candidate.sourcePath),
      });
    }
  }

  for (const root of compositionRoots(raw.relevantFiles)) {
    if (destinations.some((entry) => entry.path === root && entry.kind === "composition-root")) continue;
    destinations.push({
      path: root,
      kind: "composition-root",
      status: "existing",
      provenance: deterministic("filesystem", root),
    });
  }

  // Where a NEW page would go, by the project's own convention. Evidence of a
  // location, not a decision to use it.
  if (routingKind === "next-app-router") {
    const appRoot = raw.relevantFiles.find((file) => /(^|\/)app\/layout\.(tsx?|jsx?)$/.test(file))?.replace(/\/layout\.[^/]+$/, "");
    if (appRoot !== undefined && !destinations.some((entry) => entry.path === appRoot)) {
      destinations.push({
        path: appRoot,
        kind: "candidate-directory",
        status: "candidate-directory",
        provenance: deterministic("route_convention", appRoot),
      });
    }
  }

  const sorted = destinations.sort(
    (left, right) => left.kind.localeCompare(right.kind) || left.path.localeCompare(right.path),
  );
  if (sorted.length <= MAX_DESTINATIONS) return { destinations: sorted };
  return {
    destinations: sorted.slice(0, MAX_DESTINATIONS),
    bound: {
      collection: "destinations",
      discoveredCount: sorted.length,
      retainedCount: MAX_DESTINATIONS,
      limit: MAX_DESTINATIONS,
      exhaustive: true,
      reason: `bounded to ${MAX_DESTINATIONS} destinations, sorted by kind then path`,
    },
  };
}

/**
 * The component inventory both inspectors contribute to.
 *
 * The Stage-4 inspector reads more files and extracts prop names; the tools
 * inspector reaches more directories. Union by path, preferring the richer
 * entry, and mark design-system membership from the evidenced directories.
 */
function componentInventory(
  raw: ProjectInspectionRaw,
  implementation: Stage4ProjectImplementationContext | undefined,
  designSystemDirectories: readonly string[],
): { components: ProjectComponent[]; bound?: ProjectBound } {
  const byPath = new Map<string, ProjectComponent>();

  const memberOf = (path: string): boolean =>
    designSystemDirectories.some((directory) => path === directory || path.startsWith(`${directory}/`));

  for (const component of raw.components) {
    byPath.set(component.sourcePath, {
      name: component.name,
      path: component.sourcePath,
      exportKind: "unknown",
      exportedNames: [component.name],
      props: [...component.props],
      directory: component.sourcePath.split("/").slice(0, -1).join("/"),
      designSystemMember: memberOf(component.sourcePath),
      provenance: deterministic("filesystem", component.sourcePath),
    });
  }

  for (const component of implementation?.designSystem.components ?? []) {
    const existing = byPath.get(component.sourcePath);
    const props = component.props.map((prop) => prop.name);
    byPath.set(component.sourcePath, {
      name: component.name,
      path: component.sourcePath,
      exportKind: existing?.exportKind ?? "unknown",
      exportedNames: [...new Set([...(existing?.exportedNames ?? []), component.name])],
      props: props.length > 0 ? props : (existing?.props ?? []),
      directory: component.sourcePath.split("/").slice(0, -1).join("/"),
      designSystemMember: memberOf(component.sourcePath),
      provenance: deterministic("filesystem", component.sourcePath),
    });
  }

  const sorted = [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
  if (sorted.length <= MAX_COMPONENT_INVENTORY) return { components: sorted };
  return {
    components: sorted.slice(0, MAX_COMPONENT_INVENTORY),
    bound: {
      collection: "components",
      discoveredCount: sorted.length,
      retainedCount: MAX_COMPONENT_INVENTORY,
      limit: MAX_COMPONENT_INVENTORY,
      exhaustive: true,
      reason: `bounded to ${MAX_COMPONENT_INVENTORY} components, sorted by path`,
    },
  };
}

const STYLING_CONFIG_FILES = [
  "tailwind.config.js",
  "tailwind.config.ts",
  "tailwind.config.cjs",
  "tailwind.config.mjs",
  "postcss.config.js",
  "postcss.config.mjs",
  "unocss.config.ts",
];

/**
 * Compiles one canonical Project Context.
 *
 * Deterministic: no clock, no randomness, no network, no model. The same
 * project tree always produces the same context.
 */
export function compileProjectContext(options: CompileProjectContextOptions): CanonicalProjectContext {
  const signal = options.signal ?? new AbortController().signal;
  const raw = inspectProjectDirectory(options.root, signal);
  const aliasInspection = inspectProjectAliases(options.root);
  const implementation = options.implementationContext;

  const bounds: ProjectBound[] = [];
  const warnings: { code: string; message: string; path?: string }[] = [
    ...aliasInspection.warnings,
    ...(implementation?.warnings ?? []).map((warning) => ({
      code: warning.code,
      message: warning.message,
      ...(warning.path !== undefined ? { path: warning.path } : {}),
    })),
  ];

  // The tools inspector reports at most MAX_REPORTED_FILES paths from a walk
  // bounded at MAX_ENTRIES; when it hit the cap the true total is unknown, and
  // saying so is more useful than inventing a number.
  if (raw.relevantFiles.length >= MAX_REPORTED_FILES) {
    bounds.push({
      collection: "inspectedFiles",
      retainedCount: raw.relevantFiles.length,
      limit: MAX_REPORTED_FILES,
      exhaustive: false,
      reason: `the project walk reports at most ${MAX_REPORTED_FILES} files (walk bounded at ${MAX_ENTRIES} entries); the true file count is not known from this inspection`,
    });
  }

  const manifest = readPackageManifest(options.root);
  const dependencies = manifest === null ? [...(implementation?.runtime.dependencies ?? [])] : dependencyNames(manifest);
  const framework = raw.frameworks[0] ?? implementation?.runtime.framework;
  const routing = detectRouting(raw, framework, dependencies);

  const designSystemPackage = detectDesignSystemPackage(dependencies) ?? raw.designSystemPackage;
  const designSystemDirectories = designSystemDirectoriesOf(raw);
  const genericComponentDirectories = [
    ...new Set(
      raw.components
        .map((component) => component.sourcePath.split("/").slice(0, -1).join("/"))
        .filter((directory) => directory.length > 0 && !designSystemDirectories.includes(directory)),
    ),
  ].sort();

  const { components, bound: componentBound } = componentInventory(raw, implementation, designSystemDirectories);
  if (componentBound !== undefined) bounds.push(componentBound);

  const { destinations, bound: destinationBound } = destinationsFrom(raw, routing.kind);
  if (destinationBound !== undefined) bounds.push(destinationBound);

  const commands = Object.values(implementation?.commands ?? {})
    .filter((command): command is NonNullable<typeof command> => command !== undefined)
    .map((command) => ({
      name: command.name,
      scriptName: command.scriptName,
      executable: command.executable,
      args: [...command.args],
      required: command.required,
    }));

  const stylingConfigPaths = STYLING_CONFIG_FILES.filter((file) => raw.relevantFiles.includes(file));
  const strategies = [...new Set([...(raw.stylingStrategies ?? []), ...(implementation?.styling.strategies ?? [])])]
    .filter((strategy) => strategy !== "unknown")
    .sort();

  const context = {
    schemaVersion: CANONICAL_PROJECT_CONTEXT_SCHEMA_VERSION,
    project: {
      ...(options.projectId !== undefined ? { projectId: options.projectId } : {}),
      rootIdentity: implementation?.project.rootIdentity ?? rootIdentityOf(options.root),
      ...(implementation?.project.contextFingerprint !== undefined
        ? { contextFingerprint: implementation.project.contextFingerprint }
        : {}),
    },
    runtime: {
      ...(raw.packageManager !== undefined
        ? { packageManager: { value: raw.packageManager, provenance: deterministic("lockfile") } }
        : {}),
      ...(framework !== undefined
        ? { framework: { value: framework, provenance: deterministic("package_manifest", "package.json") } }
        : {}),
      ...(implementation?.runtime.frameworkVersion !== undefined
        ? {
            frameworkVersion: {
              value: implementation.runtime.frameworkVersion,
              provenance: deterministic("package_manifest", "package.json"),
            },
          }
        : {}),
      ...(raw.language !== undefined
        ? { language: { value: raw.language, provenance: deterministic("filesystem") } }
        : {}),
      monorepo: implementation?.runtime.monorepo ?? false,
      dependencies: [...new Set([...dependencies, ...(implementation?.runtime.dependencies ?? [])])].sort().slice(0, 400),
    },
    structure: {
      sourceRoots: [...new Set([...(implementation?.structure.sourceRoots ?? []), ...(raw.sourceRoot !== undefined ? [raw.sourceRoot] : [])])].sort(),
      routeRoots: [...(implementation?.structure.routeRoots ?? [])].sort(),
      appRoots: [...new Set(raw.relevantFiles.filter((file) => /(^|\/)app\//.test(file)).map((file) => file.slice(0, file.indexOf("app/") + 3)))].sort(),
      publicAssetRoots: [...(implementation?.structure.publicAssetRoots ?? [])].sort(),
      componentDirectories: genericComponentDirectories,
      aliases: [...aliasInspection.aliases] as ProjectAlias[],
      ...(aliasInspection.baseUrl !== undefined
        ? { baseUrl: { value: aliasInspection.baseUrl.value, provenance: aliasInspection.baseUrl.provenance } }
        : {}),
    },
    routing,
    styling: {
      strategies,
      ...(strategies[0] !== undefined ? { primaryStrategy: strategies[0] } : {}),
      configPaths: stylingConfigPaths,
      ...(stylingConfigPaths[0] !== undefined ? { provenance: deterministic("filesystem", stylingConfigPaths[0]) } : {}),
    },
    designSystem: {
      packages: designSystemPackage !== undefined
        ? [{ value: designSystemPackage, provenance: deterministic("package_manifest", "package.json") }]
        : [],
      directories: designSystemDirectories.map((directory) => ({
        value: directory,
        provenance: heuristic("filesystem", directory),
      })),
      genericComponentDirectories,
      tokenSources: [...(implementation?.designSystem.tokenSources ?? []), ...raw.tokenSources].map((entry) => ({
        path: entry.path,
        kind: entry.kind,
      })),
      tokens: [...(implementation?.designSystem.tokens ?? [])].map((token) => ({
        name: token.name,
        value: token.value,
        reference: token.reference,
        ...(token.category !== undefined ? { category: token.category } : {}),
        sourcePath: token.sourcePath,
      })),
    },
    components,
    destinations,
    commands,
    capabilities: {
      typecheck: implementation?.commands.typecheck !== undefined,
      lint: implementation?.commands.lint !== undefined,
      build: implementation?.commands.build !== undefined,
      test: implementation?.commands.test !== undefined,
      preview: implementation?.commands.preview !== undefined,
      format: implementation?.commands.format !== undefined,
    },
    testing: {
      ...(raw.testFramework !== undefined
        ? { framework: { value: raw.testFramework, provenance: deterministic("package_manifest", "package.json") } }
        : {}),
      ...(browserAutomationOf(dependencies) !== undefined
        ? {
            browserAutomation: {
              value: browserAutomationOf(dependencies)!,
              provenance: deterministic("package_manifest", "package.json"),
            },
          }
        : {}),
      colocatedTests: (implementation?.conventions.testing ?? []).length > 0,
    },
    conventions: conventionsFrom(raw, implementation, aliasInspection.aliases),
    bounds,
    warnings: warnings.slice(0, 48),
    provenance: {
      compilerVersion: PROJECT_CONTEXT_COMPILER_VERSION,
      inspectors: [
        "tools/project-inspection",
        "tools/alias-inspector",
        ...(implementation !== undefined ? ["capability-implementation/inspection"] : []),
      ],
    },
  };

  return canonicalProjectContextSchema.parse(context);
}

/**
 * Directory names that evidence a design system.
 *
 * Deliberately stricter than the shared inspector's set, which also accepts
 * plain `components`. Every React project has a `components/` folder; calling
 * it a design system would tell the Mapper that an app's one-off components
 * are a shared library, which is exactly the confusion this context exists to
 * remove. `components/ui` still qualifies — on its `ui` segment.
 */
const DESIGN_SYSTEM_DIRECTORY_NAMES = new Set(["design-system", "ui", "ui-kit", "component-library"]);

function designSystemDirectoriesOf(raw: ProjectInspectionRaw): string[] {
  const directories = new Set<string>();
  for (const file of raw.relevantFiles) {
    const segments = file.split("/").slice(0, -1);
    for (let index = 0; index < segments.length; index += 1) {
      if (DESIGN_SYSTEM_DIRECTORY_NAMES.has(segments[index]!.toLowerCase())) {
        directories.add(segments.slice(0, index + 1).join("/"));
      }
    }
  }
  // Shortest path first, so `src/components/ui` beats a nested duplicate.
  return [...directories].sort((left, right) => left.split("/").length - right.split("/").length || left.localeCompare(right));
}

const BROWSER_AUTOMATION = ["playwright", "@playwright/test", "cypress", "puppeteer"];

function browserAutomationOf(dependencies: readonly string[]): string | undefined {
  return BROWSER_AUTOMATION.find((name) => dependencies.includes(name));
}

/**
 * Identity of a root when no implementation context supplied one.
 *
 * Deliberately the same shape (a sha256 of the resolved root) the Stage-4
 * inspector uses, so the two never disagree about which project this is.
 */
function rootIdentityOf(root: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return createHash("sha256").update(root).digest("hex");
}

function conventionsFrom(
  raw: ProjectInspectionRaw,
  implementation: Stage4ProjectImplementationContext | undefined,
  aliases: readonly ProjectAlias[],
): CanonicalProjectContext["conventions"] {
  const conventions: CanonicalProjectContext["conventions"] = [];

  const extensions = [...new Set(raw.relevantFiles.map((file) => file.split(".").at(-1) ?? "").filter((ext) => ext.length > 0))].sort();
  const componentExtension = extensions.find((ext) => ["tsx", "jsx", "vue", "svelte"].includes(ext));
  if (componentExtension !== undefined) {
    conventions.push({
      kind: "file-extension",
      value: `components use .${componentExtension}`,
      provenance: deterministic("filesystem"),
    });
  }

  if (raw.sourceRoot !== undefined) {
    conventions.push({ kind: "source-root", value: raw.sourceRoot, provenance: deterministic("filesystem", raw.sourceRoot) });
  }

  const firstAlias = aliases[0];
  if (firstAlias !== undefined) {
    conventions.push({
      kind: "import-alias",
      value: `${firstAlias.pattern} → ${firstAlias.targets.join(", ")}`,
      provenance: firstAlias.provenance,
    });
  }

  // Naming is only asserted with enough evidence: three or more exported
  // components agreeing, not one arbitrary file.
  const pascal = raw.components.filter((component) => /^[A-Z][A-Za-z0-9]*$/.test(component.name));
  if (raw.components.length >= 3 && pascal.length === raw.components.length) {
    conventions.push({
      kind: "component-naming",
      value: "component names are PascalCase",
      provenance: heuristic("filesystem"),
    });
  }

  if ((implementation?.conventions.testing ?? []).length > 0) {
    conventions.push({ kind: "testing", value: "tests are colocated", provenance: heuristic("filesystem") });
  }

  return conventions;
}
