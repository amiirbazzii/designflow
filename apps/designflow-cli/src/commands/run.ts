// apps/designflow-cli/src/commands/run.ts
import {
  heading,
  type Terminal,
} from "../ui/terminal";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { EXPERIMENTAL_IMPLEMENTATION_WORKFLOW_ID, type CliContext, type ResolvedWorker } from "../services/cli-runner";
import type { WorkerInputField } from "@designflow/sdk";
import { clarify, finishSession, watchProgress } from "./session-flow";
import { buildDesignEngineerReadiness, readFigmaConnection } from "../services/readiness";
import { CLI_VERSION } from "../version";

/**
 * `designflow run <worker>` — hire a worker and see the job through.
 *
 * The name resolves through the worker catalogue, the *decision* about what to
 * do comes from an Agent Session, and the run itself goes through
 * `WorkflowRunner`. Everything shown — the checklist, the approval reason, the
 * counts, the narration — comes from the product layer, so the command counts
 * nothing and cannot disagree with the engine.
 *
 * This file does not know whether a worker delegated to an agent, and does not
 * choose a workflow: it asks the session what should happen and renders the
 * answer. Three outcomes are possible — run, ask, refuse — with no fallback of
 * its own, because a fallback would be this command quietly deciding after the
 * layer that decides declined to.
 *
 * `request_clarification` used to end the process here. Stage 39 gave it
 * somewhere to go instead: while the person is still at the terminal, this
 * loops — ask, answer, resume — bounded by the session's own externally
 * enforced turn limit. Stepping away (or running out of scripted answers, in
 * a test) leaves the session waiting rather than losing it; `designflow answer
 * <session-id>` picks the same conversation back up later.
 *
 * Input fields come from the worker's own manifest rather than a table in this
 * file, so adding a worker adds no code here.
 */

export async function runCommand(
  context: CliContext,
  terminal: Terminal,
  name: string,
  options?: { readonly projectId?: string; readonly interactive?: boolean; readonly noCache?: boolean },
): Promise<number> {
  const resolved = context.resolve(name);

  if (resolved === null) {
    terminal.print(`No such worker: ${name}`);
    terminal.print();
    terminal.print("Run  designflow list  to see who is available.");
    return 1;
  }

  const { worker, workflowId } = resolved;

  const selectedProjectId = options?.projectId;
  const isDesignEngineer = worker.workflows.includes(EXPERIMENTAL_IMPLEMENTATION_WORKFLOW_ID);

  // Deterministic prerequisite: the supported Design Engineer journey works
  // from a real, configured Figma source. Without one there is nothing
  // honest to run — the legacy scaffold is no longer presented as the
  // product — so this is setup guidance, not a session.
  const figmaAvailable =
    context.figmaSourceMode !== undefined && context.figmaSourceMode !== "placeholder";
  if (isDesignEngineer && !figmaAvailable) {
    // The same readiness model doctor renders, so the sentence a person
    // reads here is the sentence they will read there — including the
    // difference between a configuration that is missing and one that is
    // present but unusable. Progressive on purpose: only the prerequisite
    // actually in the way, not the whole diagnostic.
    const figma = readFigmaConnection(context.home.config);
    const readiness = buildDesignEngineerReadiness({
      credentialPresent: context.modelProviderConfigured,
      figma,
      projectCount: 0,
      playwrightPackageAvailable: false,
      browserAvailable: "not_checked",
      configPath: context.home.layout.configFile,
      configExists: true,
      configParsed: true,
      version: CLI_VERSION,
    });

    terminal.print(heading(worker.name));
    terminal.print(worker.description);
    terminal.print();
    terminal.print("This worker reads a connected Figma design.");
    terminal.print(readiness.figma.detail);
    if (readiness.figma.nextStep !== undefined) {
      terminal.print();
      terminal.print(readiness.figma.nextStep);
    }
    terminal.print("Nothing was run and no files were changed.");
    return 1;
  }

  if (!resolved.workflowInstalled) {
    terminal.print(
      `${worker.name} needs the "${workflowId}" workflow, which is not installed.`,
    );
    terminal.print();
    terminal.print("Install it, or run  designflow list  to see who is ready.");
    return 1;
  }

  terminal.print(heading(worker.name));
  terminal.print(worker.description);

  // Teach the worker's name when someone reaches for the workflow id.
  if (name !== worker.id) {
    terminal.print();
    terminal.print(`(${name} is a workflow — its worker is ${worker.id})`);
  }

  terminal.print();

  const input = await collectInput(terminal, resolved);

  if (isDesignEngineer && figmaAvailable) {
    // Journey consent (distinct from proposal approval): a selected project
    // is where changes COULD go, never permission to prepare them. Consent
    // is explicit, per-run, and answered at the terminal — a piped
    // invocation must supply it just as deliberately.
    let consentedProject: { id: string; name: string; rootPath: string } | undefined;
    if (selectedProjectId !== undefined) {
      const project = await context.projects.getProject(selectedProjectId).catch(() => null);
      if (project === null || project.rootPath === undefined) {
        terminal.print("A registered project with an accessible root is required before implementation.");
        return 1;
      }
      terminal.print();
      terminal.print(`Prepare implementation changes for "${project.name}"?`);
      terminal.print("DesignFlow will propose exact file changes; nothing is written");
      terminal.print("until you approve that exact proposal.");
      const consent = (await terminal.ask("Prepare changes for this project?", ["yes", "no"])).trim().toLowerCase();
      if (consent.startsWith("y")) {
        consentedProject = { id: project.id, name: project.name, rootPath: project.rootPath };
      } else {
        terminal.print("Continuing with a design specification only — no project changes will be proposed.");
      }
    }

    if (consentedProject !== undefined) {
      input.enabled = true;
      input.project = consentedProject;
      input.projectWriteConsent = true;
      input.stateDirectory = join(context.home.layout.home, "projects", consentedProject.id, "runs");
      input.implementationAgentVersion = "0.1.0";
      input.implementationAgentModelProfileId = "implementation-default";
    }

    // Shared real-Figma facts for both the specification-only and the
    // implementation journeys — always from the validated availability
    // result, never from a raw flag.
    input.figmaSourceMode = context.figmaSourceMode;
    input.refreshFigmaSource = options?.noCache === true || consentedProject !== undefined;
    if (consentedProject === undefined) input.refreshFigmaSource = true;
    if (options?.noCache === true) input.figmaCacheBypass = randomUUID();
    input.captureScreenshots = true;
    input.figmaAgentVersion = "0.1.0";
    if (context.figmaServerIdentity !== undefined) input.figmaServerIdentity = context.figmaServerIdentity;
    input.allowFixtureNames = false;
  }

  // Attached before the session starts, and left attached through the whole
  // clarification loop: a workflow might start on the very first decision, or
  // only after several resumed ones, and either way `runner.start` runs and
  // settles inside whichever `sessions` call gets there — there is no later
  // point at which attaching this would still see every step land.
  watchProgress(context, terminal);

  // The collected answers are the request. What to do with them is not this
  // command's call — a session starts, and the session decides.
  const started = await context.sessions.startSessionForWorker(resolved.worker, {
    workerId: resolved.worker.id,
    request: describeRequest(input),
    input,
    ...(options?.projectId !== undefined ? { projectId: options.projectId } : {}),
  });

  const result = await clarify(context, terminal, worker.name, started);
  if (result === null) return 1;

  return finishSession(context, terminal, result, options?.interactive ?? false);
}

// ── Input ────────────────────────────────────────────────────────

async function collectInput(
  terminal: Terminal,
  resolved: ResolvedWorker,
): Promise<Record<string, unknown>> {
  const fields: readonly WorkerInputField[] = resolved.worker.inputs;
  const input: Record<string, unknown> = {};

  for (const field of fields) {
    const answer = await terminal.ask(
      `${field.label} (${field.placeholder})`,
      field.choices,
    );

    // An empty answer stays absent. The placeholder is a visual example,
    // never data: fabricating it here used to hand the routing agent a
    // fully-populated fake request, turning "pressed Enter three times"
    // into a run instead of the clarification it deserves.
    const value = answer.trim();
    if (value.length === 0) continue;

    input[field.key] =
      field.list === true
        ? value
            .split(",")
            .map((part) => part.trim())
            .filter((part) => part.length > 0)
        : value;
  }

  return input;
}

/**
 * The collected form as a sentence.
 *
 * `run <worker>` has no free-text prompt — the answers *are* the request — so
 * this is what a decision-maker gets to read. Empty in, empty out: a form
 * nobody filled in describes no work, and saying so honestly is what lets an
 * agent ask for detail rather than be handed "{}" and guess.
 */
function describeRequest(input: Record<string, unknown>): string {
  return Object.entries(input)
    .map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : value] as const)
    .filter(([, value]) => value !== undefined && value !== null && String(value).length > 0)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join("; ");
}
