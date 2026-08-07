// apps/designflow-cli/src/commands/artifacts.ts
import { heading, type Terminal } from "../ui/terminal";
import { truncateForDisplay, type ArtifactSummary } from "@designflow/product";
import type { CliContext } from "../services/cli-runner";
import {
  describeCapability,
  describeProvenance,
  groupArtifactsByStage,
  isEvidenceArtifact,
  projectChildExecutions,
  projectFeedbackLoopIterations,
  readProvenanceFacts,
  type RelatedExecution,
} from "../services/presentation";

/**
 * `designflow artifacts <run-id> [artifact-id]` — what a run actually produced.
 *
 * The answer to "what did DesignFlow just do?" beyond a created/reused count.
 * Everything here comes from the same product-layer report `designflow
 * history` and the completion screen already use — `context.runner.explain`
 * for identity, lineage and status, `context.artifactInspection` for the
 * stored payload underneath — so this command can never show something the
 * engine did not actually record.
 *
 * A run that composed other runs also shows them, from the lineage those
 * children persisted and from the feedback loop's own parent record. Nothing
 * here relates two runs by name or by when they started.
 *
 * No artifact this reads is ever a real file in the project: every workflow
 * DesignFlow ships today only stores its output as an artifact, and the
 * detail view says so every time, the same way the completion screen does.
 */
export async function artifactsCommand(
  context: CliContext,
  terminal: Terminal,
  executionId?: string,
  artifactId?: string,
): Promise<number> {
  if (executionId === undefined) {
    terminal.print(heading("Artifacts"));
    terminal.print("Usage: designflow artifacts <run-id> [artifact-id]");
    terminal.print();
    terminal.print("Run  designflow history  to find a run id.");
    return 1;
  }

  const parent = await findParent(context, executionId);
  const artifacts = await resolveArtifacts(context, executionId);

  if (artifacts === null && parent === null) {
    terminal.print(heading("Artifacts"));
    terminal.print(`No run with that id: ${executionId}`);
    terminal.print();
    terminal.print("Run  designflow history  to see runs that do exist.");
    return 1;
  }

  const listed = artifacts ?? [];

  if (artifactId !== undefined) {
    const summary = listed.find(
      (artifact) => artifact.artifactId === artifactId,
    );

    if (summary === undefined) {
      terminal.print(heading("Artifacts"));
      terminal.print(`No artifact "${artifactId}" on run ${executionId}.`);
      terminal.print();
      terminal.print(
        `Run  designflow artifacts ${executionId}  to see the ones that do exist.`,
      );
      return 1;
    }

    const detail = await context.artifactInspection.getPayload(summary);
    renderDetail(terminal, detail.summary, detail.payload);
    return 0;
  }

  renderList(terminal, executionId, listed);

  if (parent !== null) {
    terminal.print();
    terminal.print("Correction loop");
    terminal.print(
      `  Outcome: ${parent.finalStatus?.replace(/_/g, " ") ?? "still running"}`,
    );
    if (parent.stopReason !== undefined) {
      terminal.print(`  Reason: ${parent.stopReason}`);
    }
    terminal.print(
      `  Iterations: ${parent.iterations.length} of at most ${parent.maxIterations}`,
    );
    if (parent.finalReportArtifactId !== undefined) {
      terminal.print(`  Final report: ${parent.finalReportArtifactId}`);
    }
  }

  const related = await resolveRelated(context, executionId, parent);
  if (related.length > 0) renderRelated(terminal, related);

  return 0;
}

async function findParent(
  context: CliContext,
  executionId: string,
): Promise<Awaited<ReturnType<CliContext["feedbackLoopParents"]["get"]>>> {
  const direct = await context.feedbackLoopParents.get(executionId);
  if (direct !== null) return direct;
  const parents = await context.feedbackLoopParents.list();
  return parents.find((candidate) => {
    const input = candidate.input["executionId"];
    return input === executionId;
  }) ?? null;
}

/** Resolves a run's artifacts, or `null` when there is no such run. */
async function resolveArtifacts(
  context: CliContext,
  executionId: string,
): Promise<readonly ArtifactSummary[] | null> {
  try {
    const report = await context.runner.explain(executionId);
    // Excludes the unnamed, content-addressed payload entries the completion
    // screen also leaves out — each is the same stored bytes as one of the
    // logical artifacts already listed, under a hash instead of a name, and
    // showing both would look like twice as much happened.
    return report.artifacts.filter(
      (artifact) => artifact.name !== artifact.artifactId,
    );
  } catch {
    return null;
  }
}

/**
 * The runs this one composed.
 *
 * Two persisted sources, never merged with a guess: the feedback loop's own
 * parent record, which numbers its iterations, and the execution lineage every
 * composed child writes into its own record.
 */
async function resolveRelated(
  context: CliContext,
  executionId: string,
  parent: Awaited<ReturnType<CliContext["feedbackLoopParents"]["get"]>>,
): Promise<readonly RelatedExecution[]> {
  if (parent !== null) return projectFeedbackLoopIterations(parent);

  const children = await context.runner.children(executionId);

  return projectChildExecutions(
    children.map((child) => ({
      executionId: child.executionId,
      workflowName: child.workflowName,
      statusLabel: child.statusLabel,
      summary: child.summary,
    })),
  );
}

function renderRelated(
  terminal: Terminal,
  related: readonly RelatedExecution[],
): void {
  terminal.print();
  terminal.print("Related executions");

  for (const entry of related) {
    terminal.print();
    terminal.print(`  ${entry.label}`);
    for (const line of entry.detailLines) terminal.print(`    ${line}`);
    terminal.print(`    designflow artifacts ${entry.executionId}`);
  }
}

export function renderList(
  terminal: Terminal,
  executionId: string,
  artifacts: readonly ArtifactSummary[],
): void {
  terminal.print(heading("Artifacts"));
  terminal.print(`Run: ${executionId}`);
  terminal.print();

  if (artifacts.length === 0) {
    terminal.print("No artifacts recorded for this run.");
    return;
  }

  // Stage grouping only applies to the design journey. A run with no staged
  // artifacts — a review, say — keeps the plain list, which is a better list
  // than one group called "everything".
  const groups = groupArtifactsByStage(artifacts);

  if (groups === null) {
    for (const artifact of artifacts) printArtifactLine(terminal, artifact, "  ");
  } else {
    for (const group of groups) {
      terminal.print(`  ${group.stage}`);
      for (const artifact of group.artifacts) {
        printArtifactLine(terminal, artifact, "    ");
      }
      terminal.print();
    }
  }

  terminal.print();
  terminal.print(
    `Inspect one:  designflow artifacts ${executionId} <artifact-id>`,
  );
}

/**
 * One artifact, with who produced it.
 *
 * The producer comes from the artifact's own `createdBy` provenance, so a
 * deterministic step is never labelled with somebody's name.
 */
function printArtifactLine(
  terminal: Terminal,
  artifact: ArtifactSummary,
  indent: string,
): void {
  terminal.print(
    `${indent}${artifact.artifactId}  ${artifact.name}  (${artifact.status})`,
  );

  if (artifact.createdBy !== undefined) {
    const producer = describeCapability(artifact.createdBy, artifact.createdBy);
    terminal.print(
      `${indent}  ${producer.kind === "role" ? producer.label : `${producer.label} (deterministic step)`}`,
    );
  }
}

export function renderDetail(
  terminal: Terminal,
  summary: ArtifactSummary,
  payload: unknown,
): void {
  terminal.print(heading(summary.name));
  terminal.print();
  // The artifact record itself is always internal storage. Whether the run
  // that produced it also changed project files is the run summary's fact
  // to report — an unconditional "no files changed" line here misdescribed
  // application-result artifacts whose entire purpose is recording writes.
  terminal.print("Stored internally by DesignFlow.");
  terminal.print();
  terminal.print(`Status: ${summary.status}`);

  if (summary.version !== undefined) {
    terminal.print(`Version: ${summary.version}`);
  }

  for (const line of describeProvenance(
    summary.createdBy,
    readProvenanceFacts(payload),
  )) {
    terminal.print(line);
  }

  if (summary.dependencies.length > 0) {
    terminal.print(`Depends on: ${summary.dependencies.join(", ")}`);
  }

  terminal.print();

  // Captured evidence is image and layout bytes. Printing it would fill the
  // terminal with base64 and scroll away everything that meant something.
  if (isEvidenceArtifact(summary.artifactId)) {
    terminal.print("Captured evidence — the stored bytes are not printed.");
    return;
  }

  renderPayload(terminal, payload);
}

/** A generated-source-code artifact, distinguished so its files print readably. */
interface SourceCodePayload {
  readonly framework: string;
  readonly files: readonly {
    readonly path: string;
    readonly contents: string;
  }[];
}

function isSourceCodePayload(value: unknown): value is SourceCodePayload {
  if (typeof value !== "object" || value === null) return false;
  const files = (value as Record<string, unknown>)["files"];

  return (
    Array.isArray(files) &&
    files.every(
      (file) =>
        typeof file === "object" &&
        file !== null &&
        typeof (file as Record<string, unknown>)["path"] === "string" &&
        typeof (file as Record<string, unknown>)["contents"] === "string",
    )
  );
}

function renderPayload(terminal: Terminal, payload: unknown): void {
  if (payload === undefined) {
    terminal.print("(no stored payload found)");
    return;
  }

  if (isSourceCodePayload(payload)) {
    terminal.print(`Framework: ${payload.framework}`);
    terminal.print();
    terminal.print(
      payload.files.length > 0 ? "Files:" : "(no files generated)",
    );

    for (const file of payload.files) {
      terminal.print();
      terminal.print(file.path);
      terminal.print("-".repeat(Math.max(1, Math.min(file.path.length, 60))));
      printBounded(
        terminal,
        file.contents.length > 0 ? file.contents : "(empty file)",
      );
    }

    return;
  }

  printBounded(terminal, JSON.stringify(payload, null, 2));
}

function printBounded(terminal: Terminal, text: string): void {
  const bounded = truncateForDisplay(text);
  terminal.print(bounded.text);

  if (bounded.truncated) {
    terminal.print(
      `… truncated (${bounded.totalLength - bounded.text.length} more characters)`,
    );
  }
}
