// apps/designflow-cli/src/services/readiness.ts
import { basename } from "node:path";
import type { Config } from "./config";
import { readFigmaMcpConfig } from "./figma-mcp-config";

/**
 * One readiness model, shared by `doctor`, `settings` and `run`.
 *
 * Three commands used to answer "can this actually run?" in three
 * vocabularies — doctor listed checks, run printed its own setup paragraph,
 * settings said nothing at all — so the same broken setup read as three
 * different problems. This file is the single derivation: pure, injected
 * facts in, human next steps out.
 *
 * Two rules hold everywhere below:
 *
 * **No credential ever appears here.** `credentialPresent` is a boolean, and
 * the only credential vocabulary in this file is the *name* of an
 * environment variable to set. Nothing reads `process.env` for a value.
 *
 * **Nothing is persisted.** `buildDesignEngineerReadiness` is a pure
 * function of its argument, and the assembler below only reads an
 * already-loaded config. Diagnosing a setup must never change it.
 */

// ── Facts in ────────────────────────────────────────────────────

/**
 * How a Figma connection is configured — three states, not two.
 *
 * `readFigmaMcpConfig` answers `undefined` both for "no `figmaMcp` block"
 * and for "a `figmaMcp` block that does not parse", and those two deserve
 * opposite advice: one says *add configuration*, the other says *fix the
 * configuration you already wrote*. The discriminator lives in
 * `readFigmaConnection` below and reuses the same reader rather than
 * duplicating its parse.
 */
export type FigmaConnectionState = "missing" | "invalid" | "configured";

export type FigmaTransport = "stdio" | "http";

export interface FigmaConnectionFacts {
  readonly state: FigmaConnectionState;
  readonly transport?: FigmaTransport;
}

/** Whether Chromium could be launched, or whether that was not attempted at all. */
export type BrowserAvailability = boolean | "not_checked";

export interface ReadinessFacts {
  /** True when a model-provider credential is present in the environment. Never its value. */
  readonly credentialPresent: boolean;
  readonly figma: FigmaConnectionFacts;
  readonly projectCount: number;
  readonly playwrightPackageAvailable: boolean;
  readonly browserAvailable: BrowserAvailability;
  /** The public worker resolves to its canonical specification workflow. */
  readonly specificationDispatchAvailable: boolean;
  /** The consent-gated implementation workflow is registered. */
  readonly implementationDispatchAvailable: boolean;
  readonly configPath: string;
  readonly configExists: boolean;
  readonly configParsed: boolean;
  readonly version: string;
}

// ── Facts out ───────────────────────────────────────────────────

export interface ReadinessLine {
  readonly detail: string;
  readonly nextStep?: string;
}

export interface JourneyReadiness {
  readonly ready: boolean;
  /** Empty when ready. Each entry is one thing standing in the way. */
  readonly reasons: readonly string[];
  readonly notes: readonly string[];
}

export interface DesignEngineerReadiness {
  readonly version: string;
  readonly configuration: ReadinessLine;
  /** `live` only when a credential is present; `deterministic` is a real, supported mode. */
  readonly modelMode: "live" | "deterministic";
  readonly model: ReadinessLine;
  readonly figma: ReadinessLine & FigmaConnectionFacts;
  readonly projects: ReadinessLine & { readonly count: number };
  readonly visualValidation: ReadinessLine;
  readonly specification: JourneyReadiness;
  readonly implementationProposal: JourneyReadiness;
  /** Built, exercised in isolation, and not yet reachable from the primary journey. */
  readonly visualCorrection: "beta_unconnected";
  readonly visualCorrectionDetail: string;
}

export const DESIGN_ENGINEER_READINESS_TITLE = "Design Engineer readiness";

const CREDENTIAL_ENV_NAME = "OPENROUTER_API_KEY";
const DOCTOR_COMMAND = "designflow doctor";
const PROJECTS_ADD_COMMAND = "designflow projects add --name <name> --path <path>";

const CONSENT_NOTE =
  "Each run asks for explicit consent before preparing changes for a project.";
const APPROVAL_NOTE =
  "Nothing is written until you approve the exact proposed changes.";

// ── Derivation ──────────────────────────────────────────────────

function figmaLine(facts: ReadinessFacts): ReadinessLine & FigmaConnectionFacts {
  const { state, transport } = facts.figma;

  if (state === "configured") {
    return {
      state,
      ...(transport !== undefined ? { transport } : {}),
      detail: `Configured (${transport === "http" ? "local HTTP endpoint" : "stdio server command"}).`,
      nextStep: `Run  ${DOCTOR_COMMAND}  after changing it; connection is proven by a real run, not by configuration alone.`,
    };
  }

  if (state === "invalid") {
    return {
      state,
      detail: `A figmaMcp block is present in ${facts.configPath} but does not describe a usable server.`,
      nextStep:
        "Fix the figmaMcp block: stdio needs a command, and a local endpoint needs transport \"http\" plus a url.",
    };
  }

  return {
    state,
    detail: "No Figma connection is configured.",
    nextStep: `Add a figmaMcp block to ${facts.configPath}, then run  ${DOCTOR_COMMAND}.`,
  };
}

function projectsLine(facts: ReadinessFacts): ReadinessLine & { readonly count: number } {
  if (facts.projectCount === 0) {
    return {
      count: 0,
      detail: "No projects are registered; a design specification still runs without one.",
      nextStep: `Register one with  ${PROJECTS_ADD_COMMAND}  to allow proposed implementation changes.`,
    };
  }

  return {
    count: facts.projectCount,
    detail: `${facts.projectCount} project${facts.projectCount === 1 ? "" : "s"} registered.`,
  };
}

function visualValidationLine(facts: ReadinessFacts): ReadinessLine {
  if (!facts.playwrightPackageAvailable) {
    return {
      detail: "The optional Playwright package is not installed, so screenshots cannot be captured.",
      nextStep: "Install the optional Playwright package, then install Chromium for it.",
    };
  }

  if (facts.browserAvailable === "not_checked") {
    return { detail: "Playwright is installed; a browser launch was not attempted." };
  }

  if (!facts.browserAvailable) {
    return {
      detail: "Playwright is installed, but Chromium could not be launched.",
      nextStep: "Run  bunx playwright install chromium  or  npx playwright install chromium.",
    };
  }

  return { detail: "Playwright and Chromium are available." };
}

function modelLine(facts: ReadinessFacts): ReadinessLine {
  if (facts.credentialPresent) {
    return {
      detail: "Live model reasoning is enabled; the credential's value is never read, shown or stored.",
    };
  }

  return {
    detail: "Deterministic fallback: no model-provider credential is present in the environment.",
    nextStep: `Set ${CREDENTIAL_ENV_NAME} in your shell environment for live reasoning. Deterministic runs need no credential.`,
  };
}

function configurationLine(facts: ReadinessFacts): ReadinessLine {
  if (!facts.configExists) {
    return {
      detail: `No configuration file at ${facts.configPath}; built-in defaults are in effect.`,
      nextStep: `The next run creates it. Run  ${DOCTOR_COMMAND}  afterwards to confirm.`,
    };
  }

  if (!facts.configParsed) {
    return {
      detail: `${facts.configPath} could not be read as valid configuration.`,
      nextStep: "Fix the file, or move it aside and let the next run recreate it.",
    };
  }

  return { detail: `${facts.configPath} (read, valid).` };
}

/**
 * The whole readiness picture, derived from injected facts alone.
 *
 * Side-effect free by construction: no filesystem, no environment, no
 * network, no clock. Every caller — doctor, settings, run — passes facts it
 * already gathered, which is what makes all three say the same sentence
 * about the same broken setup.
 */
export function buildDesignEngineerReadiness(facts: ReadinessFacts): DesignEngineerReadiness {
  const figma = figmaLine(facts);

  const specificationReasons: string[] = [];
  if (facts.figma.state !== "configured") specificationReasons.push(figma.detail);
  if (!facts.specificationDispatchAvailable) {
    specificationReasons.push(
      "The Design Engineer specification journey is unavailable in this installation.",
    );
  }

  const implementationReasons = [...specificationReasons];
  if (!facts.implementationDispatchAvailable) {
    implementationReasons.push(
      "The Design Engineer implementation journey is unavailable in this installation.",
    );
  }
  if (facts.projectCount === 0) {
    implementationReasons.push(
      `No registered project to propose changes for — ${PROJECTS_ADD_COMMAND}.`,
    );
  }

  return {
    version: facts.version,
    configuration: configurationLine(facts),
    modelMode: facts.credentialPresent ? "live" : "deterministic",
    model: modelLine(facts),
    figma,
    projects: projectsLine(facts),
    visualValidation: visualValidationLine(facts),
    specification: {
      ready: specificationReasons.length === 0,
      reasons: specificationReasons,
      notes: ["Reads the configured design and produces a specification. No project files are touched."],
    },
    implementationProposal: {
      ready: implementationReasons.length === 0,
      reasons: implementationReasons,
      notes: [CONSENT_NOTE, APPROVAL_NOTE],
    },
    visualCorrection: "beta_unconnected",
    visualCorrectionDetail:
      "Beta: exercised on its own, and not yet connected to the primary journey.",
  };
}

// ── Assembly from a live CLI context ────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Missing versus invalid, without a second parser.
 *
 * `readFigmaMcpConfig` stays the only thing that decides what a valid block
 * is. This adds one bit it deliberately does not carry: whether a block was
 * written at all. A record that the reader still refused is a mistake the
 * user can fix; no record at all is a step they have not taken yet.
 */
export function readFigmaConnection(config: Config): FigmaConnectionFacts {
  const parsed = readFigmaMcpConfig(config);
  if (parsed !== undefined) return { state: "configured", transport: parsed.transport };
  return { state: isRecord(config.settings["figmaMcp"]) ? "invalid" : "missing" };
}

/** What the assembler needs from a live context — structural, so nothing here depends on wiring. */
export interface ReadinessContextFacts {
  readonly config: Config;
  readonly configPath: string;
  readonly configExists: boolean;
  readonly configParsed: boolean;
  readonly credentialPresent: boolean;
  readonly projectCount: number;
  readonly playwrightPackageAvailable: boolean;
  readonly browserAvailable: BrowserAvailability;
  readonly specificationDispatchAvailable: boolean;
  readonly implementationDispatchAvailable: boolean;
  readonly version: string;
}

export function assembleDesignEngineerReadiness(
  facts: ReadinessContextFacts,
): DesignEngineerReadiness {
  return buildDesignEngineerReadiness({
    credentialPresent: facts.credentialPresent,
    figma: readFigmaConnection(facts.config),
    projectCount: facts.projectCount,
    playwrightPackageAvailable: facts.playwrightPackageAvailable,
    browserAvailable: facts.browserAvailable,
    specificationDispatchAvailable: facts.specificationDispatchAvailable,
    implementationDispatchAvailable: facts.implementationDispatchAvailable,
    configPath: facts.configPath,
    configExists: facts.configExists,
    configParsed: facts.configParsed,
    version: facts.version,
  });
}

// ── Figma metadata, safe to display ─────────────────────────────

/**
 * What `designflow settings` may say about a configured Figma connection.
 *
 * Metadata only, and narrowed on purpose: a URL becomes host and port, a
 * server command becomes its basename, and `envPassthrough` contributes
 * variable *names*. A full URL can carry a token in its query string and a
 * full command line can carry one in an argument — neither ever reaches a
 * terminal from here.
 */
export interface FigmaMcpDisplay {
  readonly state: FigmaConnectionState;
  readonly transport?: FigmaTransport;
  /** `host:port` for a local endpoint, or the server command's basename. */
  readonly target?: string;
  readonly envPassthroughNames: readonly string[];
}

function envPassthroughNames(config: Config): readonly string[] {
  const raw = config.settings["figmaMcp"];
  if (!isRecord(raw)) return [];
  const names = raw["envPassthrough"];
  if (!Array.isArray(names)) return [];
  return names.filter((name): name is string => typeof name === "string");
}

export function describeFigmaMcp(config: Config): FigmaMcpDisplay {
  const parsed = readFigmaMcpConfig(config);
  const names = envPassthroughNames(config);

  if (parsed === undefined) {
    return { state: readFigmaConnection(config).state, envPassthroughNames: names };
  }

  if (parsed.transport === "http") {
    let target = "configured endpoint";
    try {
      const url = new URL(parsed.url);
      target = url.port.length > 0 ? `${url.hostname}:${url.port}` : url.hostname;
    } catch {
      // A URL the parser accepted but `URL` cannot read stays unnamed rather
      // than being echoed back verbatim.
    }
    return { state: "configured", transport: "http", target, envPassthroughNames: names };
  }

  return {
    state: "configured",
    transport: "stdio",
    target: basename(parsed.command),
    envPassthroughNames: names,
  };
}

// ── Feature tiers ───────────────────────────────────────────────

export interface FeatureTier {
  readonly name: string;
  readonly tier: "supported" | "beta" | "compatibility-only";
  readonly note: string;
}

/**
 * What each capability actually claims today.
 *
 * "Supported" here means implemented and exercised in this repository's
 * tests — not verified against a real Figma workspace and a real model
 * provider, which is MVP-4's job. Saying so in the same line as the claim
 * is the point.
 */
export const FEATURE_TIERS: readonly FeatureTier[] = [
  {
    name: "Design specification",
    tier: "supported",
    note: "Pending real-environment evidence in the next milestone.",
  },
  {
    name: "Implementation proposal and apply",
    tier: "supported",
    note: "Pending real-environment evidence; always gated by per-run consent and exact-proposal approval.",
  },
  {
    name: "Visual correction",
    tier: "beta",
    note: "Not yet connected to the primary command.",
  },
  {
    name: "Legacy scaffold workflow",
    tier: "compatibility-only",
    note: "Kept so older runs stay readable; not the product path.",
  },
];

// ── Roles ───────────────────────────────────────────────────────

/**
 * The five roles behind the one worker, named for a person rather than by id.
 *
 * Ids are not display names: a role's model profile id is an internal
 * reference, and the composition root supplies it rather than this file
 * spelling one out — a literal here would be a second copy of a fact the
 * agent packages already own.
 */
export type DesignRoleId =
  | "coordinator"
  | "specification"
  | "implementation"
  | "visual-validation"
  | "visual-correction";

const ROLE_NAMES: Readonly<Record<DesignRoleId, string>> = {
  coordinator: "Design Engineer Coordinator",
  specification: "Figma Specification Specialist",
  implementation: "Implementation Specialist",
  "visual-validation": "Visual Validation Specialist",
  "visual-correction": "Visual Correction Specialist (beta)",
};

/**
 * The human name for a role, for any surface that needs one.
 *
 * Exported so progress, artifact provenance and traces can name the same
 * five roles without a second copy of the wording — this file stays the only
 * place in the shell where a role's human name is written down.
 */
export function designRoleName(roleId: DesignRoleId): string {
  return ROLE_NAMES[roleId];
}

export const DESIGN_ROLE_ORDER: readonly DesignRoleId[] = [
  "coordinator",
  "specification",
  "implementation",
  "visual-validation",
  "visual-correction",
];

/** The fields a local override may change — the same five `model-config.ts` extracts. */
export interface ModelProfileFields {
  readonly providerId: string;
  readonly model: string;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly timeoutMs?: number;
}

export interface RoleModelProfile {
  readonly roleId: DesignRoleId;
  readonly profileId: string;
  /** After local overrides were merged — what a run would really use. */
  readonly effective: ModelProfileFields;
  /** Before any override — what the agent package ships. */
  readonly builtIn: ModelProfileFields;
}

export type FieldSource = "built-in" | "override";

export interface RoleModelProfileField {
  readonly label: string;
  /** Always the canonical value — the id DesignFlow itself compares. */
  readonly value: string;
  readonly source: FieldSource;
  /**
   * Marks a field whose canonical value is an internal id, so the renderer
   * can show its display name. The id stays here unchanged; translating it in
   * this file would put a provider's display name in the model a run reads.
   */
  readonly kind?: "provider";
}

export interface RoleModelProfileView {
  readonly roleName: string;
  readonly profileId: string;
  readonly fields: readonly RoleModelProfileField[];
}

function source(effective: unknown, builtIn: unknown): FieldSource {
  return effective === builtIn ? "built-in" : "override";
}

/**
 * Each role as `designflow settings` shows it, with per-field provenance.
 *
 * Provenance is computed by comparing the merged profile against the
 * built-in one rather than by reading the override file a second time —
 * so a field the override named but did not actually change reads as
 * built-in, which is what it is.
 */
export function describeRoleModelProfiles(
  roles: readonly RoleModelProfile[],
): readonly RoleModelProfileView[] {
  return roles.map((role) => {
    const fields: RoleModelProfileField[] = [
      {
        label: "Provider",
        value: role.effective.providerId,
        source: source(role.effective.providerId, role.builtIn.providerId),
        kind: "provider",
      },
      {
        label: "Model",
        value: role.effective.model,
        source: source(role.effective.model, role.builtIn.model),
      },
    ];

    const optional: readonly [string, number | undefined, number | undefined][] = [
      ["Temperature", role.effective.temperature, role.builtIn.temperature],
      ["Max output tokens", role.effective.maxOutputTokens, role.builtIn.maxOutputTokens],
      ["Timeout (ms)", role.effective.timeoutMs, role.builtIn.timeoutMs],
    ];

    for (const [label, effective, builtIn] of optional) {
      if (effective === undefined) continue;
      fields.push({ label, value: String(effective), source: source(effective, builtIn) });
    }

    return { roleName: ROLE_NAMES[role.roleId], profileId: role.profileId, fields };
  });
}
