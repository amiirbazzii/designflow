// packages/agents/src/project-mapper/test/fixtures/mapping-project-contexts.ts
//
// Deterministic project fixtures for mapping, shaped like the projects
// DesignFlow actually meets. These are `CanonicalProjectContext` values, not
// filesystems: V2-3 maps compiled facts, and compiling those facts is V2-2's
// job and already has its own fixtures.
import { canonicalProjectContextSchema, type CanonicalProjectContext } from "@designflow/sdk";

const deterministic = { source: "filesystem" as const, confidence: "deterministic" as const };

function component(
  name: string,
  path: string,
  options: { designSystemMember?: boolean; props?: string[] } = {},
): Record<string, unknown> {
  return {
    name,
    path,
    exportKind: "named",
    exportedNames: [name],
    props: options.props ?? [],
    directory: path.split("/").slice(0, -1).join("/"),
    designSystemMember: options.designSystemMember ?? false,
    provenance: { ...deterministic, path },
  };
}

function base(overrides: Record<string, unknown>): CanonicalProjectContext {
  return canonicalProjectContextSchema.parse({
    schemaVersion: "1",
    project: { projectId: "project-fixture", rootIdentity: "root-identity-1", contextFingerprint: "fingerprint-1" },
    runtime: {
      framework: { value: "next", provenance: { source: "package_manifest", path: "package.json", confidence: "deterministic" } },
      language: { value: "typescript", provenance: deterministic },
      monorepo: false,
      dependencies: ["next", "react", "react-dom"],
    },
    structure: {
      sourceRoots: ["src"],
      routeRoots: ["src/app"],
      appRoots: ["src/app"],
      publicAssetRoots: ["public"],
      componentDirectories: ["src/components"],
      aliases: [
        { pattern: "@/*", targets: ["./src/*"], resolvedTargets: ["src"], provenance: { source: "tsconfig", path: "tsconfig.json", confidence: "deterministic" } },
      ],
    },
    routing: { kind: "next-app-router", provenance: { source: "route_convention", confidence: "deterministic" }, routeFileConvention: "app/**/page.tsx" },
    styling: { strategies: ["tailwind"], primaryStrategy: "tailwind", configPaths: ["tailwind.config.ts"] },
    designSystem: {
      packages: [],
      directories: [{ value: "src/components/ui", provenance: { source: "filesystem", path: "src/components/ui", confidence: "heuristic" } }],
      genericComponentDirectories: ["src/components"],
      tokenSources: [{ path: "src/styles/globals.css", kind: "css-variables" }],
      tokens: [
        { name: "surface-muted", value: "#F8F8F8", reference: "var(--surface-muted)", category: "color", sourcePath: "src/styles/globals.css" },
        { name: "radius-md", value: "10px", reference: "var(--radius-md)", category: "radii", sourcePath: "src/styles/globals.css" },
      ],
    },
    components: [],
    destinations: [
      { path: "src/app/layout.tsx", kind: "composition-root", status: "existing", provenance: { ...deterministic, path: "src/app/layout.tsx" } },
      { path: "src/app/page.tsx", kind: "page", route: "/", status: "existing", provenance: { source: "route_convention", path: "src/app/page.tsx", confidence: "deterministic" } },
      { path: "src/app", kind: "candidate-directory", status: "candidate-directory", provenance: { source: "route_convention", path: "src/app", confidence: "deterministic" } },
    ],
    commands: [{ name: "build", scriptName: "build", executable: "bun", args: ["run", "build"], required: true }],
    capabilities: { typecheck: true, lint: true, build: true, test: true, preview: true, format: false },
    testing: { framework: { value: "vitest", provenance: { source: "package_manifest", path: "package.json", confidence: "deterministic" } }, colocatedTests: false },
    conventions: [{ kind: "import-alias", value: "@/* → ./src/*", provenance: { source: "tsconfig", path: "tsconfig.json", confidence: "deterministic" } }],
    bounds: [],
    warnings: [],
    provenance: { compilerVersion: "1", inspectors: ["tools/project-inspection"] },
    ...overrides,
  });
}

/** A. A design system with compatible equivalents for most of the design. */
export const REUSE_READY_PROJECT = base({
  components: [
    component("Button", "src/components/ui/button.tsx", { designSystemMember: true, props: ["label", "variant", "onClick"] }),
    component("TextField", "src/components/ui/text-field.tsx", { designSystemMember: true, props: ["placeholder", "leading", "trailing", "value"] }),
    component("HistoryCard", "src/components/ui/history-card.tsx", { designSystemMember: true, props: ["title", "amount"] }),
    component("NavigationMenuV3", "src/components/ui/navigation-menu-v3.tsx", { designSystemMember: true, props: ["items", "variant"] }),
  ],
});

/** B. The TextField exists but cannot express a select/trailing slot. */
export const EXTENSION_REQUIRED_PROJECT = base({
  components: [
    component("Button", "src/components/ui/button.tsx", { designSystemMember: true, props: ["label"] }),
    component("TextField", "src/components/ui/text-field.tsx", { designSystemMember: true, props: ["placeholder", "value"] }),
  ],
});

/** C/D. Several plausible candidates, none obviously right. */
export const MULTI_CANDIDATE_PROJECT = base({
  components: [
    component("TextField", "src/components/ui/text-field.tsx", { designSystemMember: true }),
    component("FormField", "src/components/form-field.tsx"),
    component("InputField", "src/components/input-field.tsx"),
    component("Input", "src/components/input.tsx"),
    component("FieldInput", "src/components/legacy/field-input.tsx"),
    component("BareInput", "src/components/legacy/bare-input.tsx"),
  ],
});

/** E. A project with no router and no existing page to reuse. */
export const NO_ROUTER_PROJECT = base({
  routing: { kind: "unknown" },
  destinations: [
    { path: "src/App.tsx", kind: "composition-root", status: "existing", provenance: { ...deterministic, path: "src/App.tsx" } },
  ],
  components: [component("Button", "src/components/Button.tsx")],
  runtime: {
    framework: { value: "react", provenance: { source: "package_manifest", path: "package.json", confidence: "deterministic" } },
    language: { value: "typescript", provenance: deterministic },
    monorepo: false,
    dependencies: ["react", "vite"],
  },
});

/** F. Almost nothing to map onto. */
export const SPARSE_PROJECT = base({
  components: [],
  destinations: [],
  designSystem: { packages: [], directories: [], genericComponentDirectories: [], tokenSources: [], tokens: [] },
  structure: { sourceRoots: ["src"], routeRoots: [], appRoots: [], publicAssetRoots: [], componentDirectories: [], aliases: [] },
});

/** A project with more candidate components than a requirement may offer. */
export function manyCandidateProject(count: number): CanonicalProjectContext {
  return base({
    components: Array.from({ length: count }, (_, index) =>
      component(`TextField${String(index).padStart(2, "0")}`, `src/components/text-field-${String(index).padStart(2, "0")}.tsx`),
    ),
  });
}
