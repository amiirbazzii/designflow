// apps/designflow-cli/src/commands/run.ts
import {
  heading,
  type Terminal,
} from "../ui/terminal";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { DESIGN_TO_CODE_V2_WORKFLOW_ID, EXPERIMENTAL_IMPLEMENTATION_WORKFLOW_ID, type CliContext, type ResolvedWorker } from "../services/cli-runner";
import { findDestinationCandidates, type DestinationCandidate } from "../services/destinations";
import type { ApprovalMode, SessionResult, WorkerInputField } from "@designflow/sdk";
import { clarify, finishSession, watchProgress, type ProductReviewRequest } from "./session-flow";
import { buildDesignEngineerReadiness, readFigmaConnection } from "../services/readiness";
import { CLI_VERSION } from "../version";
import type { InteractiveDesign } from "../services/figma-selection";

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
  options?: {
    readonly projectId?: string;
    readonly interactive?: boolean;
    /** The menu shell, not direct `run`, may offer immediate artifact viewing. */
    readonly offerArtifactView?: boolean;
    /** Product-stage progress is reserved for the bare interactive shell. */
    readonly productExperience?: boolean;
    /** A shell-selected destination carried as request context. */
    readonly destination?: DestinationCandidate;
    /** A shell-selected Figma source; explicit commands keep their prompts. */
    readonly design?: InteractiveDesign;
    /** Per-run approval authorization selected by the product TUI. */
    readonly approvalMode?: ApprovalMode;
    readonly noCache?: boolean;
    readonly visualCorrection?: "off" | "once";
    readonly onProgress?: (progress: Parameters<Parameters<CliContext["onProgress"]>[0]>[0]) => void;
    readonly onSessionResult?: (result: SessionResult) => void;
    readonly onReview?: (request: ProductReviewRequest) => Promise<"approve" | "reject">;
  },
): Promise<number> {
  await context.refreshAiSession();
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
  const productShellImplementation =
    options?.productExperience === true &&
    isDesignEngineer &&
    options.design !== undefined &&
    options.destination !== undefined;

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
      specificationDispatchAvailable: resolved.workflowInstalled,
      implementationDispatchAvailable: context.implementationWorkflowAvailable,
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

  const input = productShellImplementation
    ? buildInteractiveImplementationInput(options.design!, options.destination!, options.approvalMode ?? "manual")
    : await collectInput(terminal, resolved, options?.design);

  if (isDesignEngineer && figmaAvailable) {
    // The normal product shell has already collected the user's two product
    // decisions: design and destination. That is intent to prepare a
    // proposal, not permission to write files. Explicit `run` callers retain
    // the older, separately collected preparation consent for compatibility.
    let implementationProject: { id: string; name: string; rootPath: string } | undefined;
    if (selectedProjectId !== undefined) {
      const project = await context.projects.getProject(selectedProjectId).catch(() => null);
      if (project === null || project.rootPath === undefined) {
        terminal.print("A registered project with an accessible root is required before implementation.");
        return 1;
      }
      if (productShellImplementation) {
        implementationProject = { id: project.id, name: project.name, rootPath: project.rootPath };
      } else {
        terminal.print();
        terminal.print(`Prepare implementation changes for "${project.name}"?`);
        terminal.print("DesignFlow will propose exact file changes; nothing is written");
        terminal.print("until you approve that exact proposal.");
        const consent = (await terminal.ask("Prepare changes for this project?", ["yes", "no"])).trim().toLowerCase();
        if (consent.startsWith("y")) {
          implementationProject = { id: project.id, name: project.name, rootPath: project.rootPath };
        } else {
          terminal.print("Continuing with a design specification only — no project changes will be proposed.");
        }
      }
    }

    if (implementationProject !== undefined) {
      input.enabled = true;
      input.project = implementationProject;
      if (productShellImplementation) input.implementationIntent = true;
      else input.projectWriteConsent = true;
      input.stateDirectory = join(context.home.layout.home, "projects", implementationProject.id, "runs");
      input.implementationAgentVersion = "0.1.0";
      input.implementationAgentModelProfileId = "implementation-default";
    }

    // Shared real-Figma facts for both the specification-only and the
    // implementation journeys — always from the validated availability
    // result, never from a raw flag.
    input.figmaSourceMode = context.figmaSourceMode;
    if (options?.design !== undefined) {
      input.figmaSourceKind = options.design.kind === "current-selection" ? "current-selection" : "figma-url";
    }
    input.refreshFigmaSource = options?.noCache === true || implementationProject !== undefined;
    if (implementationProject === undefined) input.refreshFigmaSource = true;
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
  watchProgress(context, terminal, {
    productExperience: options?.productExperience === true,
    ...(options?.onProgress === undefined ? {} : { onProgress: options.onProgress }),
  });

  // V2-8: Design Engineer dispatch is deterministic and product-owned. With a
  // project and a destination decision the flagship V2 workflow starts
  // directly; without a project the read-only specification journey does.
  // No Coordinator model call decides this — missing information is a product
  // question asked above, never AI reasoning.
  let started: SessionResult;
  if (isDesignEngineer && figmaAvailable) {
    const implementationProject = input.project as { id: string; name: string; rootPath: string } | undefined;
    let destination = options?.destination;

    if (implementationProject !== undefined && destination === undefined) {
      // Product-owned clarification (§5): where should the design go?
      const registered = await context.projects.getProject(implementationProject.id).catch(() => null);
      const candidates = await findDestinationCandidates(context, registered).catch(() => [] as const);
      const answer = (
        await terminal.ask(
          "Where should this design go?",
          candidates.length > 0 ? candidates.map((candidate) => candidate.label) : undefined,
        )
      ).trim();
      destination =
        candidates.find((candidate) => candidate.label === answer) ??
        (answer.length > 0 ? { label: answer, kind: "new-page", path: answer } : undefined);
      if (destination === undefined) {
        terminal.print("A destination is required to prepare implementation changes. Nothing was run.");
        return 1;
      }
    }

    const flagship = implementationProject !== undefined && destination !== undefined;
    started = await context.sessions.startDeterministicSession(
      resolved.worker,
      {
        workerId: resolved.worker.id,
        request: describeRequest(input, destination),
        input: flagship ? buildFlagshipInput(input, implementationProject!, destination!) : input,
        ...(options?.projectId !== undefined ? { projectId: options.projectId } : {}),
      },
      flagship ? DESIGN_TO_CODE_V2_WORKFLOW_ID : resolved.workflowId,
    );
  } else {
    // Other workers keep their existing (possibly agent-routed) dispatch.
    started = await context.sessions.startSessionForWorker(resolved.worker, {
      workerId: resolved.worker.id,
      request: describeRequest(input, options?.destination),
      input,
      ...(options?.projectId !== undefined ? { projectId: options.projectId } : {}),
    });
  }
  options?.onSessionResult?.(started);

  const result = await clarify(context, terminal, worker.name, started, options?.onSessionResult);
  if (result === null) return 1;
  options?.onSessionResult?.(result);

  return finishSession(context, terminal, result, {
    interactive: options?.interactive ?? false,
    offerArtifactView: options?.offerArtifactView ?? false,
    productExperience: options?.productExperience === true,
    ...(options?.visualCorrection !== undefined
      ? { visualCorrection: options.visualCorrection }
      : {}),
    ...(options?.onReview === undefined ? {} : { onReview: options.onReview }),
  });
}

// ── Input ────────────────────────────────────────────────────────

export async function collectInput(
  terminal: Terminal,
  resolved: ResolvedWorker,
  design?: InteractiveDesign,
): Promise<Record<string, unknown>> {
  const fields: readonly WorkerInputField[] = resolved.worker.inputs;
  const input: Record<string, unknown> = {};

  const prefilled: Readonly<Record<string, unknown>> =
    design === undefined
      ? {}
      : { designFile: design.designFile, frames: [...design.frames] };

  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(prefilled, field.key)) {
      input[field.key] = prefilled[field.key];
      continue;
    }

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
 * The flagship V2 workflow input, assembled from the collected legacy-shaped
 * form: the user's two decisions (design, destination), the registered
 * project, and the already-validated Figma source facts. Everything else the
 * V2 chain discovers or compiles itself.
 */
function buildFlagshipInput(
  input: Record<string, unknown>,
  project: { id: string; name: string; rootPath: string },
  destination: DestinationCandidate,
): Record<string, unknown> {
  return {
    project,
    stateDirectory: input.stateDirectory,
    designFile: input.designFile,
    frames: Array.isArray(input.frames) ? input.frames : [],
    destination: { ...destination },
    captureScreenshots: input.captureScreenshots ?? true,
    refreshFigmaSource: input.refreshFigmaSource ?? true,
    allowFixtureNames: input.allowFixtureNames ?? false,
    ...(typeof input.figmaSourceMode === "string" ? { figmaSourceMode: input.figmaSourceMode } : {}),
    ...(typeof input.figmaSourceKind === "string" ? { figmaSourceKind: input.figmaSourceKind } : {}),
    ...(typeof input.figmaServerIdentity === "string" ? { figmaServerIdentity: input.figmaServerIdentity } : {}),
    ...(typeof input.figmaCacheBypass === "string" ? { figmaCacheBypass: input.figmaCacheBypass } : {}),
  };
}

/**
 * The bare product shell has already collected the user's design and
 * destination decisions. It synthesizes implementation intent here so the
 * coordinator receives a truthful request without another generic question.
 * `implementationIntent` is deliberately distinct from the explicit CLI's
 * `projectWriteConsent`: neither value authorizes proposal application.
 */
export function buildInteractiveImplementationInput(
  design: InteractiveDesign,
  destination: DestinationCandidate,
  approvalMode: ApprovalMode = "manual",
): Record<string, unknown> {
  return {
    request: `Implement the selected design at ${destination.label} in the detected project. Prepare reviewed implementation changes. Do not modify the project without exact proposal approval.`,
    designFile: design.designFile,
    frames: [...design.frames],
    destination: { ...destination },
    approvalMode,
    approvalSelectedAt: Date.now(),
  };
}

/**
 * The collected form as a sentence.
 *
 * `run <worker>` has no free-text prompt — the answers *are* the request — so
 * this is what a decision-maker gets to read. Empty in, empty out: a form
 * nobody filled in describes no work, and saying so honestly is what lets an
 * agent ask for detail rather than be handed "{}" and guess.
 */
export function describeRequest(
  input: Record<string, unknown>,
  destination?: DestinationCandidate,
): string {
  const fields = Object.entries(input)
    .map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : value] as const)
    .filter(([, value]) => value !== undefined && value !== null && String(value).length > 0)
    .map(([key, value]) => `${key}: ${String(value)}`);

  if (destination !== undefined) {
    fields.push(`destination: ${destination.label}`);
  }

  return fields.join("; ");
}
