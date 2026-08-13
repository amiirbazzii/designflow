// packages/sdk/src/project-context/canonical-project-context.ts
import { z } from "zod";

/**
 * The canonical Project Context (Agent Architecture V2, phase V2-2).
 *
 * DesignFlow's deterministic understanding of the target project, compiled
 * once per run and consumed by later stages instead of being rediscovered.
 * It answers *what the project is* — framework, routing, aliases, design
 * system, components, validation commands — and never *what should be built
 * in it*. Reuse/extend/create decisions, file plans and code belong to the
 * Project Mapper (V2-3), which takes this and a UI Blueprint as its inputs.
 *
 * Naming: the existing `ProjectContext` in `durable-project-facts.ts` is the
 * cross-run *fact table* and keeps that name; this is the per-run canonical
 * compilation, so it is `CanonicalProjectContext`. The two are deliberately
 * different things — see the module README.
 *
 * Everything here is compiled from the filesystem by deterministic
 * inspectors. No model participates, and every meaningful fact carries
 * provenance saying which file it came from and how strongly it is evidenced.
 */

export const CANONICAL_PROJECT_CONTEXT_SCHEMA_VERSION = "1";

/** Artifact identity for the per-run compilation. Wiring lands with V2-3. */
export const PROJECT_CONTEXT_ARTIFACT_ID = "project-context";
export const PROJECT_CONTEXT_ARTIFACT_TYPE = "project.context";

// ── Provenance ──────────────────────────────────────────────────

/**
 * Where a fact came from.
 *
 * Deliberately narrower than a free-form string: an implementer reading
 * "framework = next" needs to know whether that came from `package.json` or
 * from someone's guess about a directory name.
 */
export const projectEvidenceSourceSchema = z.enum([
  "package_manifest",
  "lockfile",
  "tsconfig",
  "jsconfig",
  "filesystem",
  "route_convention",
  "file_content",
  "durable_fact",
]);

export type ProjectEvidenceSource = z.infer<typeof projectEvidenceSourceSchema>;

/**
 * How strongly a fact is evidenced.
 *
 * `deterministic` — read directly from a declaration (a dependency, a
 * `paths` entry, a lockfile). `high` — an unambiguous convention (a file at
 * `app/page.tsx` in a Next project). `heuristic` — a pattern match that is
 * usually right and must never be treated as authority.
 */
export const projectEvidenceConfidenceSchema = z.enum(["deterministic", "high", "heuristic"]);

export type ProjectEvidenceConfidence = z.infer<typeof projectEvidenceConfidenceSchema>;

export const projectProvenanceSchema = z
  .object({
    source: projectEvidenceSourceSchema,
    /** Project-relative path of the file the fact was read from. */
    path: z.string().max(400).optional(),
    confidence: projectEvidenceConfidenceSchema,
  })
  .strict();

export type ProjectProvenance = z.infer<typeof projectProvenanceSchema>;

/** A value plus where it came from. Used wherever the source actually matters. */
export function evidencedValueSchema<T extends z.ZodTypeAny>(value: T) {
  return z
    .object({
      value,
      provenance: projectProvenanceSchema,
    })
    .strict();
}

// ── Bounds ──────────────────────────────────────────────────────

/**
 * What a bound dropped, whenever one did.
 *
 * `discoveredCount` is optional on purpose: when a walk stops early the total
 * is genuinely unknown, and reporting a made-up total would be worse than
 * saying so. `exhaustive: false` means "there may be more".
 */
export const projectBoundSchema = z
  .object({
    collection: z.string().min(1).max(80),
    discoveredCount: z.number().int().nonnegative().optional(),
    retainedCount: z.number().int().nonnegative(),
    limit: z.number().int().nonnegative().optional(),
    exhaustive: z.boolean(),
    reason: z.string().min(1).max(240),
  })
  .strict();

export type ProjectBound = z.infer<typeof projectBoundSchema>;

// ── Runtime and structure ───────────────────────────────────────

export const projectRuntimeSchema = z
  .object({
    packageManager: evidencedValueSchema(z.string().min(1).max(40)).optional(),
    framework: evidencedValueSchema(z.string().min(1).max(60)).optional(),
    frameworkVersion: evidencedValueSchema(z.string().min(1).max(60)).optional(),
    language: evidencedValueSchema(z.enum(["typescript", "javascript"])).optional(),
    monorepo: z.boolean().default(false),
    /** Every declared dependency name, sorted. Never versions of transitives. */
    dependencies: z.array(z.string().min(1).max(200)).max(400).default([]),
  })
  .strict();

/**
 * One declared path alias.
 *
 * `resolvedTargets` is what actually exists on disk; a declaration whose
 * target is missing stays visible with an empty list rather than being
 * dropped, because "the project declares `@/*` but the directory is gone" is
 * a fact a mapper needs.
 */
export const projectAliasSchema = z
  .object({
    pattern: z.string().min(1).max(200),
    targets: z.array(z.string().min(1).max(400)).max(16).default([]),
    resolvedTargets: z.array(z.string().min(1).max(400)).max(16).default([]),
    provenance: projectProvenanceSchema,
  })
  .strict();

export type ProjectAlias = z.infer<typeof projectAliasSchema>;

export const projectStructureSchema = z
  .object({
    sourceRoots: z.array(z.string().min(1).max(200)).max(24).default([]),
    routeRoots: z.array(z.string().min(1).max(200)).max(48).default([]),
    appRoots: z.array(z.string().min(1).max(200)).max(24).default([]),
    publicAssetRoots: z.array(z.string().min(1).max(200)).max(16).default([]),
    componentDirectories: z.array(z.string().min(1).max(200)).max(48).default([]),
    aliases: z.array(projectAliasSchema).max(64).default([]),
    /** `compilerOptions.baseUrl`, when one is declared. */
    baseUrl: evidencedValueSchema(z.string().min(1).max(400)).optional(),
  })
  .strict();

// ── Routing and destinations ────────────────────────────────────

export const projectRoutingKindSchema = z.enum([
  "next-app-router",
  "next-pages-router",
  "react-router",
  "vue-router",
  "svelte-kit",
  "unknown",
]);

export const projectRoutingSchema = z
  .object({
    kind: projectRoutingKindSchema.default("unknown"),
    provenance: projectProvenanceSchema.optional(),
    routeFileConvention: z.string().min(1).max(120).optional(),
  })
  .strict();

/**
 * Somewhere a generated screen could live, or the file that would make it
 * reachable. Evidence only — choosing one is the Mapper's job.
 */
export const projectDestinationSchema = z
  .object({
    path: z.string().min(1).max(400),
    kind: z.enum(["page", "component", "composition-root", "candidate-directory"]),
    /** URL path when the convention determines one, e.g. `/add`. */
    route: z.string().min(1).max(200).optional(),
    status: z.enum(["existing", "candidate-directory", "route-convention", "explicitly-selected"]),
    provenance: projectProvenanceSchema,
  })
  .strict();

export type ProjectDestination = z.infer<typeof projectDestinationSchema>;

// ── Styling, design system, components ──────────────────────────

export const projectStylingSchema = z
  .object({
    strategies: z.array(z.string().min(1).max(60)).max(16).default([]),
    primaryStrategy: z.string().min(1).max(60).optional(),
    /** Config files that define the styling system (tailwind.config.*, etc.). */
    configPaths: z.array(z.string().min(1).max(400)).max(16).default([]),
    provenance: projectProvenanceSchema.optional(),
  })
  .strict();

export const projectTokenSchema = z
  .object({
    name: z.string().min(1).max(160),
    value: z.string().max(400),
    reference: z.string().min(1).max(200),
    category: z.string().min(1).max(40).optional(),
    sourcePath: z.string().min(1).max(400),
  })
  .strict();

/**
 * Design-system evidence, split by kind.
 *
 * A published package and a local `src/components/ui` directory are different
 * facts with different consequences, and a generic `components/` folder is
 * neither — calling all three "the design system" is how a mapper ends up
 * treating an app's one-off components as a shared library.
 */
export const projectDesignSystemSchema = z
  .object({
    packages: z.array(evidencedValueSchema(z.string().min(1).max(200))).max(16).default([]),
    directories: z.array(evidencedValueSchema(z.string().min(1).max(400))).max(16).default([]),
    genericComponentDirectories: z.array(z.string().min(1).max(400)).max(48).default([]),
    tokenSources: z.array(z.object({ path: z.string().min(1).max(400), kind: z.string().min(1).max(60) }).strict()).max(24).default([]),
    tokens: z.array(projectTokenSchema).max(400).default([]),
  })
  .strict();

export const projectComponentSchema = z
  .object({
    name: z.string().min(1).max(160),
    path: z.string().min(1).max(400),
    exportKind: z.enum(["default", "named", "both", "unknown"]).default("unknown"),
    exportedNames: z.array(z.string().min(1).max(160)).max(24).default([]),
    /** Prop names, when a `*Props` declaration was safely extractable. */
    props: z.array(z.string().min(1).max(120)).max(64).default([]),
    directory: z.string().min(1).max(400).optional(),
    /** True when the file sits under an evidenced design-system directory. */
    designSystemMember: z.boolean().default(false),
    provenance: projectProvenanceSchema,
  })
  .strict();

export type ProjectComponent = z.infer<typeof projectComponentSchema>;

// ── Validation capability and conventions ───────────────────────

export const projectCommandSchema = z
  .object({
    name: z.string().min(1).max(40),
    scriptName: z.string().min(1).max(80),
    executable: z.string().min(1).max(40),
    args: z.array(z.string().min(1).max(80)).max(8).default([]),
    required: z.boolean().default(false),
  })
  .strict();

export const projectTestingSchema = z
  .object({
    framework: evidencedValueSchema(z.string().min(1).max(60)).optional(),
    /** Deterministic e2e/browser evidence (playwright, cypress). */
    browserAutomation: evidencedValueSchema(z.string().min(1).max(60)).optional(),
    colocatedTests: z.boolean().default(false),
  })
  .strict();

export const projectCapabilitiesSchema = z
  .object({
    typecheck: z.boolean().default(false),
    lint: z.boolean().default(false),
    build: z.boolean().default(false),
    test: z.boolean().default(false),
    preview: z.boolean().default(false),
    format: z.boolean().default(false),
  })
  .strict();

export const projectConventionSchema = z
  .object({
    kind: z.enum([
      "file-extension",
      "component-naming",
      "route-file",
      "import-alias",
      "source-root",
      "component-directory",
      "export-style",
      "testing",
    ]),
    value: z.string().min(1).max(240),
    provenance: projectProvenanceSchema,
  })
  .strict();

// ── The canonical context ───────────────────────────────────────

export const canonicalProjectContextSchema = z
  .object({
    schemaVersion: z.literal(CANONICAL_PROJECT_CONTEXT_SCHEMA_VERSION),
    project: z
      .object({
        projectId: z.string().min(1).max(200).optional(),
        /** Stable identity of the registered root. Never the raw path. */
        rootIdentity: z.string().min(1).max(200),
        /**
         * The same content fingerprint the implementation context computes,
         * so a compiled context can be checked against the project state an
         * approval was bound to. Never recomputed differently here.
         */
        contextFingerprint: z.string().min(1).max(200).optional(),
      })
      .strict(),
    runtime: projectRuntimeSchema,
    structure: projectStructureSchema,
    routing: projectRoutingSchema,
    styling: projectStylingSchema,
    designSystem: projectDesignSystemSchema,
    components: z.array(projectComponentSchema).max(400).default([]),
    destinations: z.array(projectDestinationSchema).max(64).default([]),
    commands: z.array(projectCommandSchema).max(16).default([]),
    capabilities: projectCapabilitiesSchema,
    testing: projectTestingSchema,
    conventions: z.array(projectConventionSchema).max(32).default([]),
    /** Retrieval limitations a consumer must reason about. */
    bounds: z.array(projectBoundSchema).max(24).default([]),
    warnings: z
      .array(z.object({ code: z.string().min(1).max(80), message: z.string().min(1).max(400), path: z.string().max(400).optional() }).strict())
      .max(48)
      .default([]),
    provenance: z
      .object({
        compilerVersion: z.string().min(1).max(40),
        /** Which deterministic inspectors contributed, by name. */
        inspectors: z.array(z.string().min(1).max(80)).max(8).default([]),
      })
      .strict(),
  })
  .strict();

export type CanonicalProjectContext = z.infer<typeof canonicalProjectContextSchema>;
