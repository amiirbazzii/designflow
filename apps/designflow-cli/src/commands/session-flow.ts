// apps/designflow-cli/src/commands/session-flow.ts
import {
  heading,
  stepMarker,
  type Terminal,
} from "../ui/terminal";

import {
  EXPERIMENTAL_IMPLEMENTATION_WORKFLOW_ID,
  FEEDBACK_LOOP_WORKFLOW_ID,
  deriveImplementationCoveragePlan,
  inspectRegisteredProject,
  type CliContext,
} from "../services/cli-runner";
import { generatedImplementationSchema, type SessionResult } from "@designflow/sdk";
import type { ArtifactSummary } from "@designflow/product";
import { renderDetail, renderList } from "./artifacts";
import {
  classifyVisualOutcome,
  describeProvenance,
  describeVisualOutcome,
  progressLabel,
  readProvenanceFacts,
  renderProductProgress,
  renderProductRunResult,
} from "../services/presentation";
import {
  prepareVisualCorrection,
  projectParentId,
  readImplementationInput,
  VISUAL_CORRECTION_BETA_LABEL,
} from "../services/visual-correction";
import { createOrLoadParent, runParentLoop } from "./feedback-loop";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderProposalPreview, type ProposalPreviewEntry } from "../services/proposal-preview";
import {
  buildProposalReview,
  renderReadyToApply,
  renderReviewFileList,
  type ReviewCheck,
} from "../services/proposal-review";

/**
 * What `designflow run` and `designflow answer` share once a session exists.
 *
 * Starting a session and resuming one differ only in how the first decision
 * is reached — everything after that first decision is the same: keep
 * clarifying while the person is willing to, then report what a completed,
 * declined, or otherwise closed session came to. Two commands sharing this
 * cannot render the same outcome two different ways.
 */

// ── Clarification ────────────────────────────────────────────────

/**
 * Answers a `request_clarification` decision inline, for as long as the
 * person stays at the terminal.
 *
 * Each loop is one resumed decision, bounded by the session's own turn
 * limit — enforced by `AgentSessionService`, not by a counter here. A
 * `terminal.ask` that cannot produce an answer — end of input, or `Ctrl+C` on
 * a real terminal — leaves the session exactly where it was: `waiting_for_user`,
 * resumable later with `designflow answer <session-id>`.
 *
 * Returns `null` when the session was left waiting rather than resolved, so
 * the caller can stop without treating an unanswered session as a failure.
 */
export async function clarify(
  context: CliContext,
  terminal: Terminal,
  workerName: string,
  result: SessionResult,
): Promise<SessionResult | null> {
  let current = result;

  while (current.session.status === "waiting_for_user") {
    terminal.print();
    terminal.print(heading(`${workerName} needs more information`));
    terminal.print(current.message ?? current.session.currentQuestion ?? "");
    terminal.print();
    terminal.print("Enter an answer now, or press Ctrl+C to continue later.");

    let answer: string;
    try {
      answer = await terminal.ask("Answer");
    } catch {
      return saveAndStop(terminal, current.session.id);
    }

    // A `Terminal` that has run out of input does not always throw the way
    // an interactive one does on `Ctrl+C` — piped, non-TTY stdin (a script,
    // a CI job) simply returns an empty string once its queued answers are
    // exhausted. Treated identically to the thrown case: the session is left
    // exactly where it was, resumable later, rather than handing an empty
    // string to `answerSession` and letting its own `.min(1)` validation
    // throw a raw schema error the person never asked to see.
    if (answer.trim().length === 0) {
      return saveAndStop(terminal, current.session.id);
    }

    current = await context.sessions.answerSession({
      sessionId: current.session.id,
      answer,
    });
  }

  return current;
}

function saveAndStop(terminal: Terminal, sessionId: string): null {
  terminal.print();
  terminal.print("Session saved.");
  terminal.print();
  terminal.print("Resume with:");
  terminal.print(`  designflow answer ${sessionId}`);
  terminal.print();
  return null;
}

// ── Outcome ─────────────────────────────────────────────────────

/**
 * Renders whatever a session settled on: declined, completed, or otherwise
 * closed.
 *
 * `offerArtifactView` — the interactive "view artifacts now?" follow-up —
 * is an explicit menu-shell opt-in. `designflow run <worker>` can still be an
 * interactive terminal journey (for example, beta correction consent), but
 * its scripted answers remain exactly its declared input fields.
 */
export async function finishSession(
  context: CliContext,
  terminal: Terminal,
  result: SessionResult,
  options: {
    readonly interactive?: boolean;
    readonly offerArtifactView?: boolean;
    readonly productExperience?: boolean;
    readonly visualCorrection?: "off" | "once";
  } = {},
): Promise<number> {
  if (result.session.status === "declined") {
    terminal.print();
    terminal.print(heading("Not started"));
    terminal.print(result.message ?? "");
    terminal.print();
    return 1;
  }

  if (result.session.status !== "completed" || result.session.executionId === undefined) {
    terminal.print();
    terminal.print(heading("Not started"));
    terminal.print("That could not be completed.");
    terminal.print();
    return 1;
  }

  const executionId = result.session.executionId;
  const approved = await resolveApproval(
    context,
    terminal,
    executionId,
    result.session.originalInput,
    options.productExperience === true,
  );

  if (approved === false) {
    if (options.productExperience === true) {
      terminal.print(
        renderProductRunResult({
          state: "failed",
          status: "rejected",
          hasImplementation: false,
          hasSpecification: true,
          hasValidation: false,
          validationFailed: false,
          rollbackTriggered: false,
        }).join("\n"),
      );
      return 1;
    }

    terminal.print();
    terminal.print(heading("Rejected"));
    terminal.print("You rejected the proposed changes.");
    terminal.print("Nothing was written to your project.");
    terminal.print("Everything produced before the approval is still stored as artifacts.");
    terminal.print();
    terminal.print(`Inspect the result: designflow artifacts ${executionId}`);
    terminal.print();
    terminal.print(`Run id: ${executionId}`);
    terminal.print();
    return 1;
  }

  return report(context, terminal, executionId, result.session.originalInput, options);
}

/** Returns undefined when no approval was required. */
async function resolveApproval(
  context: CliContext,
  terminal: Terminal,
  executionId: string,
  originalInput?: unknown,
  productExperience = false,
): Promise<boolean | undefined> {
  const pending = await context.runner.pendingApproval(executionId);
  if (pending === null) return undefined;

  if (productExperience && pending.workflowId === EXPERIMENTAL_IMPLEMENTATION_WORKFLOW_ID) {
    const reviewed = await resolveProductImplementationReview(context, terminal, executionId, originalInput);
    if (reviewed !== undefined) return reviewed;
    // No proposal artifact to review — fall through to the legacy prompt.
  }

  terminal.print();
  terminal.print(heading("Approval required"));
  const stage4 = pending.workflowId === EXPERIMENTAL_IMPLEMENTATION_WORKFLOW_ID;
  if (stage4) {
    await renderImplementationPreview(context, terminal, executionId, originalInput);
  } else {
    terminal.print("DesignFlow wants permission to:");
    terminal.print();
    terminal.print("  Store the generated result as a DesignFlow artifact");
    terminal.print("  (this does not change any file in your project)");
  }
  terminal.print();
  terminal.print(`Reason: ${pending.reason}`);
  terminal.print();

  const answer = await terminal.ask("Approve?", ["approve", "reject"]);
  const approved = answer.trim().toLowerCase().startsWith("a");

  const outcome = approved
    ? await context.runner.approve(executionId, "approved from the CLI")
    : await context.runner.reject(executionId, "rejected from the CLI");

  terminal.print();
  terminal.print(outcome.message);

  return approved;
}

async function report(
  context: CliContext,
  terminal: Terminal,
  executionId: string,
  originalInput: unknown,
  options: {
    readonly interactive?: boolean;
    readonly offerArtifactView?: boolean;
    readonly productExperience?: boolean;
    readonly visualCorrection?: "off" | "once";
  },
): Promise<number> {
  const result = await context.runner.explain(executionId);
  const { overview, artifacts } = result;

  if (options.productExperience === true) {
    const validation = artifacts.find((artifact) => artifact.artifactId === "implementation-validation");
    let validationFailed = false;
    let rollbackTriggered = false;
    if (validation !== undefined) {
      const detail = await context.artifactInspection.getPayload(validation);
      const payload = detail.payload as {
        checks?: Array<{ status: string }>;
        rollbackTriggered?: boolean;
      };
      validationFailed = payload.checks?.some((check) => check.status === "failed") === true;
      rollbackTriggered = payload.rollbackTriggered === true;
    }

    // Truthful Applying status: each line appears only when the matching
    // artifact proves the step actually happened in this run.
    const hasSnapshot = artifacts.some((artifact) => artifact.artifactId === "project-snapshot");
    const hasApplication = artifacts.some((artifact) => artifact.artifactId === "file-application-result");
    if (hasSnapshot || hasApplication) {
      terminal.print();
      terminal.print("Applying");
      terminal.print();
      if (hasSnapshot) terminal.print("✓ Snapshot created");
      if (hasApplication) terminal.print("✓ Changes applied");
      if (validation !== undefined && !validationFailed) terminal.print("✓ Build passed");
      if (validationFailed) {
        terminal.print("✗ Validation failed");
        if (rollbackTriggered) terminal.print("↩ Rolling back changes");
      }
    }

    terminal.print(
      renderProductRunResult({
        state: overview.state,
        status: overview.status,
        hasImplementation: artifacts.some((artifact) => artifact.artifactId === "file-application-result"),
        hasSpecification: artifacts.some(
          (artifact) =>
            artifact.artifactId === "design-specification" ||
            artifact.artifactId === "stage-3-summary",
        ),
        hasValidation: validation !== undefined,
        validationFailed,
        rollbackTriggered,
      }).join("\n"),
    );

    if (overview.state === "ready" && options.offerArtifactView === true) {
      const named = artifacts.filter((artifact) => artifact.name !== artifact.artifactId);
      if (named.length > 0) {
        await offerArtifactView(context, terminal, executionId, artifacts);
      }
    }

    const baseCode = overview.state === "ready" ? 0 : 1;
    if (baseCode !== 0 || options.visualCorrection === "off") return baseCode;
    return offerVisualCorrection(
      context,
      terminal,
      executionId,
      originalInput,
      options,
    );
  }

  terminal.print();
  terminal.print(
    heading(
      overview.state === "ready"
        ? "Complete"
        : overview.status === "cancelled"
          ? "Cancelled"
          : "Stopped",
    ),
  );
  terminal.print(overview.summary);

  if (overview.status === "cancelled") {
    terminal.print("The run was cancelled before it finished.");
  }

  if (overview.state !== "ready") {
    const validation = artifacts.find((artifact) => artifact.artifactId === "implementation-validation");
    if (validation !== undefined) {
      const detail = await context.artifactInspection.getPayload(validation);
      const payload = detail.payload as { checks?: Array<{ name: string; status: string }>; rollbackTriggered?: boolean };
      const failed = payload.checks?.find((check) => check.status === "failed");
      terminal.print();
      terminal.print(`Implementation validation failed${failed ? `: ${failed.name}` : "."}`);
      if (payload.rollbackTriggered) terminal.print("DesignFlow restored the project to its previous state.");
      terminal.print("No generated changes remain in the project.");
    }
    if (overview.failureReason !== undefined) {
      terminal.print(`Reason: ${overview.failureReason}`);
    }
    // Write-status honesty on the stopped path too: a rejected or otherwise
    // unfinished implementation must say plainly whether the project was
    // touched, derived from what actually ran — never from the workflow id.
    const applied = artifacts.some((artifact) => artifact.artifactId === "file-application-result");
    if (!applied) {
      terminal.print("No changes were applied to your project.");
    }
  }

  if (overview.durationLabel !== undefined) {
    terminal.print(`Took ${overview.durationLabel}.`);
  }

  // Write status is derived from what actually ran — the presence of the
  // application-result artifact — never from the command or workflow name.
  if (overview.state === "ready") {
    const implementation = artifacts.some((artifact) => artifact.artifactId === "file-application-result");
    const specificationArtifact = artifacts.find(
      (artifact) =>
        artifact.artifactId === "design-specification" ||
        artifact.artifactId === "stage-3-summary",
    );
    if (implementation) {
      terminal.print("Project files were updated after your approval.");
    } else if (specificationArtifact !== undefined) {
      terminal.print("Design specification generated — no project files were written.");
      // Who produced it, from the artifact's own provenance — a run that
      // fell back to a deterministic path must not read as an agent's work.
      const detail = await context.artifactInspection.getPayload(specificationArtifact);
      for (const line of describeProvenance(
        specificationArtifact.createdBy,
        readProvenanceFacts(detail.payload),
      )) {
        terminal.print(line);
      }
    } else {
      terminal.print("Output stored as DesignFlow artifacts — no files were written to your project.");
    }
    const visual = artifacts.find((artifact) => artifact.artifactId === "stage-5-summary");
    if (visual !== undefined) {
      const detail = await context.artifactInspection.getPayload(visual);
      const payload = detail.payload as { overallStatus?: string; viewportCount?: number; critical?: number; major?: number; minor?: number; referenceMode?: string };
      terminal.print();
      terminal.print(describeVisualOutcome(classifyVisualOutcome(payload.overallStatus)));
      terminal.print(`Status: ${payload.overallStatus ?? "unknown"}`);
      terminal.print(`Viewports: ${payload.viewportCount ?? 0}`);
      terminal.print(`Critical: ${payload.critical ?? 0}`);
      terminal.print(`Major: ${payload.major ?? 0}`);
      terminal.print(`Minor: ${payload.minor ?? 0}`);
      terminal.print(`Reference mode: ${payload.referenceMode ?? "unknown"}`);
      terminal.print("No project files were changed during visual validation.");
      terminal.print("Automatic corrections have not been applied.");
    } else if (implementation) {
      terminal.print("Visual comparison has not been performed yet.");
    }
    if (implementation) terminal.print("A rollback snapshot is available.");
  }

  terminal.print();
  terminal.print(`  Created  ${overview.artifacts.created}`);
  terminal.print(`  Reused   ${overview.artifacts.reused}`);

  // Each capability also registers a content-addressed payload. Those are
  // storage detail; counting them keeps the totals reconcilable with the
  // engine without filling the terminal with hashes.
  const named = artifacts.filter((artifact) => artifact.name !== artifact.artifactId);

  if (named.length > 0) {
    terminal.print();
    terminal.print("Artifacts");

    for (const artifact of named) {
      terminal.print(`  ${artifact.name}  (${artifact.status})`);

      if (artifact.dependencies.length > 0) {
        terminal.print(`     from ${artifact.dependencies.join(", ")}`);
      }
    }

    const blobs = artifacts.length - named.length;
    if (blobs > 0) {
      terminal.print();
      terminal.print(`  ${blobs} stored payloads not listed.`);
    }
  }

  if (overview.state === "ready" && named.length > 0) {
    terminal.print();
    terminal.print(`Inspect the result: designflow artifacts ${executionId}`);

    if (options.offerArtifactView === true) {
      await offerArtifactView(context, terminal, executionId, artifacts);
    }
  }

  terminal.print();
  terminal.print(`Run id: ${executionId}`);
  terminal.print();

  const baseCode = overview.state === "ready" ? 0 : 1;
  if (baseCode !== 0 || options.visualCorrection === "off") return baseCode;
  return offerVisualCorrection(
    context,
    terminal,
    executionId,
    originalInput,
    options,
  );
}

async function offerVisualCorrection(
  context: CliContext,
  terminal: Terminal,
  executionId: string,
  originalInput: unknown,
  options: {
    readonly interactive?: boolean;
    readonly visualCorrection?: "off" | "once";
  },
): Promise<number> {
  const implementation = readImplementationInput(originalInput);
  if (implementation === undefined) return 0;

  let currentProjectFingerprint: string | undefined;
  let currentProjectRootIdentity: string | undefined;
  try {
    const inspected = inspectRegisteredProject(implementation.project);
    currentProjectFingerprint = inspected.project.contextFingerprint;
    currentProjectRootIdentity = inspected.project.rootIdentity;
  } catch {
    currentProjectFingerprint = undefined;
  }

  const parent =
    (await context.feedbackLoopParents.get(projectParentId(executionId))) ?? null;
  const visualCorrectionProfileId = context.roleModelProfiles.find(
    (profile) => profile.roleId === "visual-correction",
  )?.profileId;
  const preparation = await prepareVisualCorrection({
    executionId,
    originalInput,
    run: await context.runner.explain(executionId),
    inspection: context.artifactInspection,
    artifactStore: context.artifactStore,
    parent,
    ...(currentProjectFingerprint !== undefined
      ? { currentProjectFingerprint }
      : {}),
    ...(currentProjectRootIdentity !== undefined
      ? { currentProjectRootIdentity }
      : {}),
    ...(visualCorrectionProfileId !== undefined
      ? { modelProfileId: visualCorrectionProfileId }
      : {}),
    correctionWorkflowRegistered: context
      .listWorkflows()
      .some((workflow) => workflow.workflowId === FEEDBACK_LOOP_WORKFLOW_ID),
    pendingApproval: (await context.runner.pendingApproval(executionId)) !== null,
  });

  if (preparation.eligibility.status !== "eligible") {
    if (options.visualCorrection === "once") {
      terminal.print();
      terminal.print(`${VISUAL_CORRECTION_BETA_LABEL} unavailable`);
      terminal.print(preparation.eligibility.reason);
    }
    return 0;
  }

  const explicit = options.visualCorrection === "once";
  if (!explicit && options.interactive !== true) return 0;

  if (!explicit) {
    terminal.print();
    terminal.print(VISUAL_CORRECTION_BETA_LABEL);
    terminal.print("The Visual Correction Specialist can prepare a correction proposal.");
    terminal.print("Each iteration requires approval of the exact proposed changes.");
    terminal.print(`Maximum iterations for this continuation: ${preparation.eligibility.maximumIterations}`);
    const answer = await terminal.ask("Start a correction iteration?", ["yes", "no"]);
    if (!answer.trim().toLowerCase().startsWith("y")) {
      terminal.print("Visual correction was not started. Your existing artifacts remain available.");
      return 0;
    }
  }

  if (preparation.input === undefined) return 0;
  const correctionParent =
    parent ?? (await createOrLoadParent(context, preparation.input));
  return runParentLoop(context, terminal, correctionParent);
}

interface CoverageDisplay {
  readonly targets: readonly { readonly id: string; readonly kind?: string; readonly name?: string | undefined }[];
  readonly result: readonly { readonly targetId: string; readonly mode: string; readonly paths: readonly string[] }[];
}

/**
 * Rebuilds the host-derived coverage view for display from the run's own
 * persisted evidence (specification, mapping, project context, agent
 * claims) using the same derivation the validator used. Returns undefined
 * for older runs without coverage claims.
 */
async function readCoverageArtifact(context: CliContext, report: Awaited<ReturnType<CliContext["runner"]["explain"]>>): Promise<CoverageDisplay | undefined> {
  try {
    const payloadFor = async (artifactId: string): Promise<unknown> => {
      const summary = report.artifacts.find((artifact) => artifact.artifactId === artifactId);
      if (summary === undefined) throw new Error(`missing ${artifactId}`);
      return (await context.artifactInspection.getPayload(summary)).payload;
    };
    const plan = deriveImplementationCoveragePlan(
      await payloadFor("design-specification"),
      await payloadFor("design-system-mapping"),
      await payloadFor("project-implementation-context"),
    );
    const agentOutput = generatedImplementationSchema.parse(await payloadFor("implementation-agent-output"));
    if (agentOutput.coverageClaims.length === 0) return undefined;
    return {
      targets: plan.requiredTargets,
      result: agentOutput.coverageClaims.map((claim) => ({ targetId: claim.targetId, mode: claim.mode, paths: claim.paths })),
    };
  } catch {
    return undefined;
  }
}

async function renderImplementationPreview(context: CliContext, terminal: Terminal, executionId: string, originalInput?: unknown): Promise<void> {
  const report = await context.runner.explain(executionId);
  const proposal = report.artifacts.find((artifact) => artifact.artifactId === "proposed-file-changes");
  terminal.print("DesignFlow wants permission to apply the proposed implementation to the registered project.");
  terminal.print();
  if (proposal !== undefined) {
    const detail = await context.artifactInspection.getPayload(proposal);
    const payload = detail.payload as { projectId?: string; files?: Array<{ path: string; action: string; reason: string; content?: string }>; packageChanges?: Array<{ packageName: string }> };
    const files = Array.isArray(payload.files) ? payload.files : [];
    terminal.print(`Project: ${payload.projectId ?? "registered project"}`);
    terminal.print(`Files to create: ${files.filter((file) => file.action === "create").length}`);
    terminal.print(`Files to modify: ${files.filter((file) => file.action === "modify").length}`);
    terminal.print(`Dependencies: ${payload.packageChanges?.length ?? 0}`);
    terminal.print();
    terminal.print("No files have been changed yet.");
    terminal.print();
    for (const file of files.slice(0, 50)) terminal.print(`  ${file.action}  ${file.path} — ${file.reason}`);
    if (files.length > 50) terminal.print(`  … ${files.length - 50} more files omitted`);
    // Compact host-validated design-coverage summary: what the proposal
    // claims to cover, before what the code actually changes. The persisted
    // implementation-coverage artifact is written in the same capability
    // that stores the proposal this approval binds to; a proposal with
    // failed coverage never reaches this prompt.
    const coverage = await readCoverageArtifact(context, report);
    if (coverage !== undefined) {
      const satisfied = new Map(coverage.result.map((entry) => [entry.targetId, entry]));
      terminal.print();
      terminal.print("Design coverage:");
      for (const target of coverage.targets) {
        const claim = satisfied.get(target.id);
        terminal.print(`  ${claim !== undefined ? "✓" : "✗"} ${target.kind === "root_frame" ? "Root frame" : "Component"} · ${target.name ?? target.id}${claim !== undefined ? "" : " · missing"}`);
        if (claim !== undefined) terminal.print(`    ${claim.mode} → ${claim.paths.join(", ")}`);
      }
    }
    // The bounded review below is rendered from the exact proposal payload
    // the approval binds to. Current-file content comes from the registered
    // root when the session input can resolve it; a modify diff must show
    // what actually changes, or an empty destructive modify looks innocuous.
    const rootPath = readImplementationInput(originalInput)?.project.rootPath;
    const entries: ProposalPreviewEntry[] = files.map((file) => {
      const currentContent = rootPath === undefined || file.action === "create"
        ? undefined
        : ((): string | undefined => { try { return readFileSync(join(rootPath, file.path), "utf8"); } catch { return undefined; } })();
      return { path: file.path, action: file.action as ProposalPreviewEntry["action"], ...(file.content !== undefined ? { proposedContent: file.content } : {}), ...(currentContent !== undefined ? { currentContent } : {}) };
    });
    terminal.print();
    terminal.print("Proposed changes (bounded review):");
    for (const line of renderProposalPreview(entries)) terminal.print(line);
  }
  terminal.print();
  terminal.print("A rollback snapshot will be created before changes are applied.");
  terminal.print("Validation commands will run after approval.");
}

/**
 * Phase 8 integrated product review for the exact validated proposal.
 *
 * Presentation over the same authoritative artifacts the approval hash
 * binds: the review, the diffs, and the totals are all pure functions of
 * the stored `proposed-file-changes` payload plus the current registered
 * project file content. Approving here invokes the same `runner.approve`
 * path as the legacy prompt; viewing the diff approves nothing.
 *
 * Returns undefined when there is no proposal artifact to review, so the
 * caller can fall back to the legacy approval prompt.
 */
async function resolveProductImplementationReview(
  context: CliContext,
  terminal: Terminal,
  executionId: string,
  originalInput?: unknown,
): Promise<boolean | undefined> {
  const report = await context.runner.explain(executionId);
  const proposal = report.artifacts.find((artifact) => artifact.artifactId === "proposed-file-changes");
  if (proposal === undefined) return undefined;

  const detail = await context.artifactInspection.getPayload(proposal);
  const payload = detail.payload as { files?: Array<{ path: string; action: string; content?: string }> };
  const files = Array.isArray(payload.files) ? payload.files : [];
  if (files.length === 0) return undefined;

  const rootPath = readImplementationInput(originalInput)?.project.rootPath;
  const entries: ProposalPreviewEntry[] = files.map((file) => {
    const currentContent = rootPath === undefined || file.action === "create"
      ? undefined
      : ((): string | undefined => { try { return readFileSync(join(rootPath, file.path), "utf8"); } catch { return undefined; } })();
    return {
      path: file.path,
      action: file.action as ProposalPreviewEntry["action"],
      ...(file.content !== undefined ? { proposedContent: file.content } : {}),
      ...(currentContent !== undefined ? { currentContent } : {}),
    };
  });

  const review = buildProposalReview(entries);
  const checks = await buildReviewChecks(context, report);

  for (;;) {
    for (const line of renderReadyToApply(review, checks)) terminal.print(line);
    terminal.print();
    const choice = (await terminal.ask("Review", ["View diff", "Apply", "Reject"]))
      .trim()
      .toLowerCase();

    if (choice === "1" || choice === "view diff" || choice === "view" || choice === "diff") {
      await browseReviewDiffs(terminal, review);
      continue;
    }

    if (choice === "2" || choice === "apply" || choice === "a") {
      const confirm = (await terminal.ask("Apply these exact changes?", ["yes", "no"]))
        .trim()
        .toLowerCase();
      if (!confirm.startsWith("y")) continue;
      const outcome = await context.runner.approve(executionId, "approved from the CLI");
      terminal.print();
      terminal.print(outcome.message);
      return true;
    }

    if (choice === "3" || choice === "reject" || choice === "r") {
      const outcome = await context.runner.reject(executionId, "rejected from the CLI");
      terminal.print();
      terminal.print(outcome.message);
      return false;
    }

    terminal.print();
    terminal.print("Choose View diff, Apply, or Reject.");
  }
}

/** Per-file diff navigation; viewing never approves anything. */
async function browseReviewDiffs(
  terminal: Terminal,
  review: ReturnType<typeof buildProposalReview>,
): Promise<void> {
  for (;;) {
    for (const line of renderReviewFileList(review)) terminal.print(line);
    terminal.print("  Back");
    terminal.print();
    const answer = (await terminal.ask("File", [...review.files.map((file) => file.path), "Back"]))
      .trim();
    const lowered = answer.toLowerCase();
    if (lowered === "back" || lowered === "b" || lowered === "" || lowered === String(review.files.length + 1)) return;
    const numeric = Number.parseInt(answer, 10);
    const file = Number.isInteger(numeric) && numeric >= 1 && numeric <= review.files.length
      ? review.files[numeric - 1]
      : review.files.find((candidate) => candidate.path.toLowerCase() === lowered);
    if (file === undefined) {
      terminal.print();
      terminal.print("Choose one of the files shown, or Back.");
      continue;
    }
    terminal.print();
    for (const line of file.diff) terminal.print(line);
    terminal.print();
  }
}

/**
 * Truthful validation summary: each label appears only when the underlying
 * check demonstrably ran and passed before this screen. Reaching a stored
 * proposal at the approval gate already proves deterministic path and
 * content validation passed — the storing capability throws otherwise.
 */
async function buildReviewChecks(
  context: CliContext,
  report: Awaited<ReturnType<CliContext["runner"]["explain"]>>,
): Promise<ReviewCheck[]> {
  const checks: ReviewCheck[] = [{ label: "Safe paths" }, { label: "Proposal validated" }];
  const coverage = await readCoverageArtifact(context, report);
  if (coverage !== undefined && coverage.targets.every((target) => coverage.result.some((entry) => entry.targetId === target.id))) {
    checks.push({ label: "Design covered" });
  }
  // The compile outcome is stamped on the exact proposal artifact this
  // approval binds to (its `moduleValidation` summary fact) — read it from
  // there, not from a secondary record that may be absent at the approval
  // checkpoint.
  const proposalMetadata = await context.artifactInspection
    .getMetadata("proposed-file-changes")
    .catch(() => undefined);
  if (proposalMetadata?.["moduleValidation"] === "passed") {
    checks.push({ label: "Build checked" });
  }
  return checks;
}

/**
 * Lets someone at an interactive terminal look at what they just got, without
 * leaving the flow they are already in.
 *
 * Declining, or running with no interactive terminal behind it (an empty
 * answer, the same signal `clarify` above treats as "not answering"), moves
 * on exactly as if this were not offered at all — the printed
 * `designflow artifacts <id>` hint above remains the way to look later.
 */
async function offerArtifactView(
  context: CliContext,
  terminal: Terminal,
  executionId: string,
  artifacts: readonly ArtifactSummary[],
): Promise<void> {
  terminal.print();
  terminal.print("View artifacts now?");

  let viewMore: string;
  try {
    viewMore = await terminal.ask("View artifacts now?", ["yes", "no"]);
  } catch {
    return;
  }

  if (!viewMore.trim().toLowerCase().startsWith("y")) return;

  terminal.print();
  renderList(terminal, executionId, artifacts);

  terminal.print();
  terminal.print("Show which artifact? (id, or blank to finish)");

  let artifactId: string;
  try {
    artifactId = (
      await terminal.ask("Show which artifact? (id, or blank to finish)")
    ).trim();
  } catch {
    return;
  }

  if (artifactId.length === 0) return;

  const summary = artifacts.find((artifact) => artifact.artifactId === artifactId);

  if (summary === undefined) {
    terminal.print();
    terminal.print(`No artifact "${artifactId}" on this run.`);
    return;
  }

  const detail = await context.artifactInspection.getPayload(summary);
  terminal.print();
  renderDetail(terminal, detail.summary, detail.payload);
}

// ── Progress ────────────────────────────────────────────────────

export function renderProgress(progress: {
  readonly completed: number;
  readonly total: number;
  readonly steps: readonly {
    readonly label: string;
    readonly status: string;
    readonly capabilityId?: string | undefined;
  }[];
}): string {
  // A step that invoked a specialized agent says who is working; every other
  // step says what is happening. A capability this shell does not recognise
  // keeps the product layer's de-slugged label, so a raw id never reaches a
  // terminal.
  const lines = progress.steps.map((step) => {
    const label =
      step.capabilityId === undefined
        ? step.label
        : progressLabel(step.capabilityId, step.label);

    return `  ${stepMarker(step.status)} ${label}`;
  });

  lines.push("", `  ${progress.completed} of ${progress.total} steps`);

  return lines.join("\n");
}

/** Attaches a live checklist for whichever `sessions` call ends up starting a workflow. */
export function watchProgress(
  context: CliContext,
  terminal: Terminal,
  options: { readonly productExperience?: boolean } = {},
): void {
  let lastFrame = "";
  context.onProgress((progress) => {
    const frame =
      options.productExperience === true
        ? renderProductProgress(progress)
        : renderProgress(progress);
    if (frame === lastFrame) return;

    lastFrame = frame;
    terminal.print(frame);
  });
}
