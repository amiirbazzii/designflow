import { createRequire } from "node:module";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import type { CliContext } from "./cli-runner";
import { configSchema } from "./config";
import { readFigmaMcpConfig } from "./figma-mcp-config";
import { inspectProjectGit } from "./git-diagnostics";
import { CLI_VERSION } from "../version";

export type DoctorStatus = "healthy" | "warning" | "unavailable" | "failed";

export interface DoctorCheck {
  readonly id: string;
  readonly status: DoctorStatus;
  readonly detail: string;
  readonly nextAction?: string;
}

export interface DoctorReport {
  readonly schemaVersion: "1";
  readonly status: DoctorStatus;
  readonly checks: readonly DoctorCheck[];
}

function statusRank(status: DoctorStatus): number {
  return status === "failed" ? 4 : status === "warning" ? 3 : status === "unavailable" ? 2 : 1;
}

function overallStatus(checks: readonly DoctorCheck[]): DoctorStatus {
  return checks.reduce<DoctorStatus>((current, item) => statusRank(item.status) > statusRank(current) ? item.status : current, "healthy");
}

function check(id: string, status: DoctorStatus, detail: string, nextAction?: string): DoctorCheck {
  return { id, status, detail, ...(nextAction !== undefined ? { nextAction } : {}) };
}

function configuration(context: CliContext): DoctorCheck {
  try {
    const raw = JSON.parse(readFileSync(context.home.layout.configFile, "utf8")) as unknown;
    const parsed = configSchema.safeParse(raw);
    if (!parsed.success) return check("configuration", "failed", "config.json does not satisfy the current configuration schema.", "Fix config.json or restore a known-good backup.");
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      const allowed = ["version", "firstRunCompleted", "environment", "databasePath", "settings"];
      const unknown = Object.keys(raw as Record<string, unknown>).filter((key) => !allowed.includes(key));
      if (unknown.length > 0) return check("configuration", "warning", `Configuration is valid but contains unknown top-level fields: ${unknown.join(", ")}.`, "Remove obsolete fields or move experimental values under settings.");
    }
    return check("configuration", "healthy", `Configuration schema v${parsed.data.version} is valid.`);
  } catch {
    return check("configuration", "failed", "config.json could not be read as JSON.", "Restore config.json from a backup or use a fresh DESIGNFLOW_HOME.");
  }
}

function filesystem(context: CliContext): DoctorCheck {
  try {
    accessSync(context.home.layout.home, constants.W_OK);
    accessSync(dirname(context.databasePath), constants.W_OK);
    return check("filesystem", "healthy", "DesignFlow home and state directory are writable.");
  } catch {
    return check("filesystem", "failed", "DesignFlow home or state directory is not writable.", "Fix permissions or set DESIGNFLOW_HOME to a writable path.");
  }
}

function state(context: CliContext): DoctorCheck {
  const report = context.inspectState();
  if (report.status === "healthy") return check("state-store", "healthy", report.detail);
  return check("state-store", report.status, report.detail, report.status === "failed" ? "Preserve the state file and restore a compatible backup before resuming." : "The next durable write will add compatibility defaults.");
}

async function browser(): Promise<DoctorCheck> {
  try {
    const require = createRequire(import.meta.url);
    const playwrightPath = require.resolve("playwright") as string;
    const playwright = require("playwright") as { chromium?: { executablePath: () => string; launch: (options: { headless: boolean }) => Promise<{ close: () => Promise<void> }> } };
    const chromium = playwright.chromium;
    if (chromium === undefined) return check("browser", "unavailable", "Playwright is installed but Chromium is not exposed by the runtime.", "Install the supported Playwright package and Chromium browser.");
    const executable = chromium.executablePath();
    if (!existsSync(executable)) return check("browser", "unavailable", `Playwright resolved at ${playwrightPath}, but Chromium is not installed.`, "Run bunx playwright install chromium or npx playwright install chromium.");
    const instance = await chromium.launch({ headless: true });
    await instance.close();
    return check("browser", "healthy", `Playwright and Chromium are available (${basename(executable)}).`);
  } catch {
    return check("browser", "unavailable", "Playwright or Chromium could not be resolved or launched.", "Install Chromium for the installed CLI and rerun doctor.");
  }
}

function provider(context: CliContext): DoctorCheck {
  const configured = context.modelProviderConfigured;
  return configured ? check("model-provider", "healthy", "A model-provider credential is present in the environment; its value is not inspected or persisted.") : check("model-provider", "unavailable", "No model-provider credential is configured; deterministic execution remains available.", "Set OPENROUTER_API_KEY only in the process environment for a live model run.");
}

function figma(context: CliContext): DoctorCheck {
  const configured = readFigmaMcpConfig(context.home.config);
  return configured === undefined ? check("figma", "unavailable", "The experimental Figma MCP integration is not configured.", "Configure the approved MCP command and explicitly enable the experimental integration.") : check("figma", "warning", `Figma MCP command is configured (${configured.command}) but doctor does not launch external MCP commands.`, "Run a bounded Figma acceptance workflow to verify authentication and permissions.");
}

async function projects(context: CliContext): Promise<DoctorCheck[]> {
  const registered = await context.projects.listProjects();
  if (registered.length === 0) return [check("projects", "warning", "No registered projects were found.", "Register a project with designflow projects add --name … --path ….")];
  return registered.map((project) => {
    if (project.rootPath === undefined || !existsSync(project.rootPath)) return check(`project:${project.id}`, "failed", `${project.name} is not accessible at its registered path.`, "Restore the project path or register it again.");
    try {
      const git = inspectProjectGit(project.rootPath);
      const status: DoctorStatus = git.mergeOrRebaseInProgress || git.dirty ? "warning" : "healthy";
      return check(`project:${project.id}`, status, `${project.name} is accessible${git.isGit ? ` on ${git.branch ?? "detached HEAD"}${git.dirty ? " with a dirty working tree" : ""}` : " and is not a Git repository"}.`);
    } catch {
      return check(`project:${project.id}`, "warning", `${project.name} is accessible, but Git status could not be inspected.`);
    }
  });
}

export async function runDoctor(context: CliContext): Promise<DoctorReport> {
  const checks = [
    check("runtime", "healthy", `DesignFlow ${CLI_VERSION} on Node ${process.version}${process.versions.bun !== undefined ? ` / Bun ${process.versions.bun}` : ""}.`),
    configuration(context), filesystem(context), state(context), provider(context), figma(context),
    ...(await projects(context)), await browser(),
  ];
  return { schemaVersion: "1", status: overallStatus(checks), checks };
}
