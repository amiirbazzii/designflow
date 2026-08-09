// apps/designflow-cli/src/ui/terminal.ts
import type { HomeLayout } from "../services/home";

/**
 * Terminal rendering and the IO port.
 *
 * Kept apart from every command so the product logic is testable without a
 * terminal: commands talk to `Terminal`, and `ScriptedTerminal` drives them
 * from a list of answers while capturing what was printed.
 *
 * Nothing here knows what a workflow is. It formats strings.
 */

export interface Terminal {
  print(line?: string): void;
  ask(question: string, options?: readonly string[]): Promise<string>;
}

const RULE = "─".repeat(46);

export function heading(title: string): string {
  return `${title}\n${RULE}`;
}

// ── First run ───────────────────────────────────────────────────

/**
 * Shown once, by the invocation that creates `~/.designflow`.
 *
 * The moment after `npm install -g designflow` is the only chance to say what
 * this is, so it says it plainly and then lists what it just put on the disk —
 * an installed application should never leave someone wondering what it wrote
 * or where.
 */
export function onboarding(layout: HomeLayout): string {
  return [
    "",
    "Welcome to DesignFlow.",
    "",
    "Your AI workforce in the terminal.",
    "",
    RULE,
    "",
    `Set up  ${layout.home}`,
    "",
    "  config.json    settings you can edit",
    "  history/       your previous runs",
    "  cache/         working space",
    "",
    "Nothing leaves this machine. There is no account to create.",
    "",
  ].join("\n");
}

// ── Interactive shell ───────────────────────────────────────────

export function banner(): string {
  return "DesignFlow";
}

export function menu(): string {
  return [
    "",
    "Project",
    "  Not selected yet",
    "",
    "Design",
    "  Not selected yet",
    "",
    "Status",
    "  Ready",
    "",
    "Enter  Start Design Engineer",
    "q      Quit",
    "?      Help",
    "",
  ].join("\n");
}

export function shellHelp(): string {
  return [
    "",
    "DesignFlow help",
    "",
    "  Enter  Start the Design Engineer flow",
    "  q      Quit DesignFlow",
    "  ?      Show this help",
    "",
  ].join("\n");
}

/** What `Use an AI Worker` shows. Driven entirely by the worker registry. */
export function workerMenu(
  workers: readonly { readonly name: string; readonly description: string }[],
): string {
  const lines = ["", "Who would you like to use?", ""];

  workers.forEach((worker, index) => {
    lines.push(`  ${index + 1}. ${worker.name}`);
    lines.push(`     ${worker.description}`);
  });

  lines.push("");

  return lines.join("\n");
}

/**
 * The Settings screen.
 *
 * Read-only, and shows where to make changes rather than offering to make them.
 * Editing a JSON file is a thing users already know how to do, and a prompt
 * driven editor for four fields would be more code and more ways to corrupt the
 * file than the file itself is worth.
 *
 * There is nothing here to authenticate, and by design nothing here to point at
 * a server.
 */
/** A worker's AI assignment, as `designflow settings` may show it. */
export interface SettingsModelAssignment {
  readonly workerName: string;
  readonly providerId: string;
  readonly model: string;
  readonly credentialConfigured: boolean;
}

/**
 * "Provider: OpenRouter" reads better than "Provider: openrouter" — the only
 * translation this file does, and only for display. Everything DesignFlow
 * itself compares is still the lowercase id.
 */
export function displayProviderName(providerId: string): string {
  return providerId === "openrouter"
    ? "OpenRouter"
    : providerId.charAt(0).toUpperCase() + providerId.slice(1);
}

/** One specialized role's effective model settings, with per-field provenance. */
export interface SettingsRole {
  readonly roleName: string;
  readonly profileId: string;
  readonly fields: readonly {
    readonly label: string;
    readonly value: string;
    readonly source: "built-in" | "override";
    readonly kind?: "provider" | undefined;
  }[];
}

/** Figma connection metadata — never a URL, a command line or a credential. */
export interface SettingsFigmaMcp {
  readonly state: "missing" | "invalid" | "configured";
  readonly transport?: "stdio" | "http";
  readonly target?: string;
  readonly envPassthroughNames: readonly string[];
}

export interface SettingsFeatureTier {
  readonly name: string;
  readonly tier: string;
  readonly note: string;
}

export function settings(
  layout: HomeLayout,
  values: {
    readonly version: string;
    readonly environment: string;
    readonly historyFile: string;
    readonly workerCount: number;
    readonly modelAssignments?: readonly SettingsModelAssignment[];
    readonly sessionConfig?: {
      readonly maxClarificationTurns: number;
      readonly expirationDays: number;
    };
    readonly configuration?: {
      readonly exists: boolean;
      readonly parsed: boolean;
    };
    readonly modelMode?: {
      readonly mode: "live" | "deterministic";
      readonly credentialPresent: boolean;
      readonly providerId?: string;
    };
    /**
     * The specialized roles, already described. This file renders rows; it
     * does not know a role's name, its profile id, or which of its fields a
     * local override changed — all of which are decided one layer down, so
     * the rendering cannot drift from what a run would use.
     */
    readonly roles?: readonly SettingsRole[];
    readonly figmaMcp?: SettingsFigmaMcp;
    readonly featureTiers?: readonly SettingsFeatureTier[];
  },
): string {
  const lines = [
    "",
    heading("Settings"),
    "",
    `  Version       DesignFlow ${values.version}`,
    `  Environment   ${values.environment}`,
    `  Workers       ${values.workerCount} installed`,
    "",
    `  Home          ${layout.home}`,
    `  Config        ${layout.configFile}`,
    `  History       ${values.historyFile}`,
    `  Cache         ${layout.cache}`,
  ];

  if (values.configuration !== undefined) {
    lines.push(
      "",
      "  Configuration",
      `    File:      ${layout.configFile}`,
      `    Present:   ${values.configuration.exists ? "yes" : "no — defaults are in effect"}`,
      `    Readable:  ${values.configuration.parsed ? "yes" : "no — fix it or move it aside"}`,
    );
  }

  if (values.modelMode !== undefined) {
    lines.push(
      "",
      "  Model mode",
      `    Mode:        ${values.modelMode.mode === "live" ? "live reasoning" : "deterministic fallback"}`,
      ...(values.modelMode.providerId !== undefined
        ? [`    Provider:    ${displayProviderName(values.modelMode.providerId)}`]
        : []),
      `    Credential:  ${values.modelMode.credentialPresent ? "present in the environment (value never read or stored)" : "not set — deterministic runs need none"}`,
    );
  }

  const roles = values.roles ?? [];

  if (roles.length > 0) {
    lines.push("", "  Specialized agents");

    for (const role of roles) {
      lines.push("", `    ${role.roleName}`, `      Profile:  ${role.profileId}`);
      for (const field of role.fields) {
        // A provider id is internal vocabulary. It stays canonical in the
        // model and everywhere DesignFlow compares it; only this line shows
        // the name a person would recognise.
        const value =
          field.kind === "provider" ? displayProviderName(field.value) : field.value;

        lines.push(`      ${field.label}: ${value} (${field.source})`);
      }
    }
  }

  if (values.figmaMcp !== undefined) {
    const figma = values.figmaMcp;
    lines.push(
      "",
      "  Figma connection",
      `    Status:     ${figma.state === "configured" ? "configured" : figma.state === "invalid" ? "present but not usable" : "not configured"}`,
      ...(figma.transport !== undefined
        ? [`    Transport:  ${figma.transport === "http" ? "local HTTP" : "stdio"}`]
        : []),
      ...(figma.target !== undefined ? [`    Server:     ${figma.target}`] : []),
      ...(figma.envPassthroughNames.length > 0
        ? [`    Forwarded environment variables (names only): ${figma.envPassthroughNames.join(", ")}`]
        : []),
    );
  }

  const tiers = values.featureTiers ?? [];

  if (tiers.length > 0) {
    lines.push("", "  Feature status");
    for (const tier of tiers) {
      lines.push("", `    ${tier.name}: ${tier.tier}`, `      ${tier.note}`);
    }
  }

  const assignments = values.modelAssignments ?? [];

  if (assignments.length > 0) {
    lines.push("", "  AI assignments");

    for (const assignment of assignments) {
      lines.push(
        "",
        `    ${assignment.workerName}`,
        `      Provider:    ${displayProviderName(assignment.providerId)}`,
        `      Model:       ${assignment.model}`,
        `      Credential:  ${assignment.credentialConfigured ? "configured" : "missing"}`,
      );
    }
  }

  if (values.sessionConfig !== undefined) {
    lines.push(
      "",
      "  Sessions",
      `    Clarification limit:   ${values.sessionConfig.maxClarificationTurns} turns`,
      `    Session expiration:    ${values.sessionConfig.expirationDays} days`,
    );
  }

  lines.push(
    "",
    "  Edit config.json to change these. Set DESIGNFLOW_HOME to move the",
    "  whole directory somewhere else.",
    "",
  );

  return lines.join("\n");
}

/**
 * A `designflow run …` example naming a real installed worker.
 *
 * Every hint that suggests a command takes its worker from the registry rather
 * than from a string here. A literal would be correct only for as long as the
 * built-in catalogue does not change, and would then send someone to a worker
 * that is not installed.
 */
export function runExample(workerId: string | undefined): string {
  return `designflow run ${workerId ?? "<worker>"}`;
}

/** `✓` done, `→` underway, `○` not started. */
export function stepMarker(status: string): string {
  return status === "done" ? "✓" : status === "active" ? "→" : "○";
}

export function version(cliVersion: string): string {
  return `DesignFlow ${cliVersion}`;
}

export function usage(): string {
  return [
    "designflow — your AI workforce in the terminal",
    "",
    "Package designflow-ai; command designflow. Without installing:",
    "  npx --yes designflow-ai --help",
    "",
    "Usage:",
    "  designflow                 Interactive mode",
    "  designflow doctor [--json]  Check setup and see what is ready to run",
    "  designflow settings        Show configuration, agents and feature status",
    "  designflow projects        Register and inspect your own projects",
    "  designflow workers         Show available AI workers (alias: list)",
    "  designflow workers <id>    Show one worker's detail",
    "  designflow run <worker>    Put a worker to work",
    "    The design worker works from a connected Figma design. A",
    "    specification reads the design and writes nothing; proposed",
    "    implementation changes need per-run consent, and each exact",
    "    proposal needs your approval before anything is written.",
    "  Visual correction (Beta) is offered after eligible implementation findings",
    "  designflow feedback-loop show <parent-id>  Inspect a saved beta continuation",
    "  designflow feedback-loop resume <parent-id>  Resume a saved beta continuation",
    "  designflow feedback-loop stop <parent-id>  Stop a saved beta continuation",
    "  designflow history         Show previous runs",
    "  designflow artifacts <id>  Inspect what a run produced or reused",
    "  designflow traces          Show what past AI decisions did",
    "  designflow sessions        Show conversations waiting on you",
    "  designflow answer <id>     Answer a worker's question",
    "  designflow cancel <id>     Cancel a waiting conversation",
    "  designflow cleanup         Mark expired conversations and approvals",
    "",
    "Options:",
    "  --visual-correction=off|once  Keep correction off, or authorize one beta iteration",
    "  -h, --help                 Show this help",
    "  -v, --version              Show the installed version",
    "",
    "Environment:",
    "  DESIGNFLOW_HOME            Where DesignFlow keeps its files",
    "  DESIGNFLOW_DEBUG=1         Show full details when something fails",
    "",
  ].join("\n");
}

/** "Today 09:14" for a recent run, a date for anything older. */
export function formatWhen(timestamp: number): string {
  const when = new Date(timestamp);
  const now = new Date();

  const sameDay =
    when.getFullYear() === now.getFullYear() &&
    when.getMonth() === now.getMonth() &&
    when.getDate() === now.getDate();

  const time = when.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

  return sameDay ? `Today ${time}` : when.toLocaleDateString();
}

/** Drives a command from a fixed list of answers, capturing its output. */
export class ScriptedTerminal implements Terminal {
  public readonly output: string[] = [];
  public readonly questions: string[] = [];

  private readonly answers: string[];

  public constructor(answers: readonly string[] = []) {
    this.answers = [...answers];
  }

  public print(line = ""): void {
    this.output.push(line);
  }

  public async ask(question: string): Promise<string> {
    this.questions.push(question);

    const answer = this.answers.shift();
    if (answer === undefined) {
      throw new Error(`ScriptedTerminal ran out of answers at: ${question}`);
    }

    return answer;
  }

  public get transcript(): string {
    return this.output.join("\n");
  }
}
