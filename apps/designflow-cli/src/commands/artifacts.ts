// apps/designflow-cli/src/commands/artifacts.ts
import { heading, type Terminal } from "../ui/terminal";
import { truncateForDisplay, type ArtifactSummary } from "@designflow/product";
import type { CliContext } from "../services/cli-runner";

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

  const artifacts = await resolveArtifacts(context, terminal, executionId);
  if (artifacts === null) return 1;

  if (artifactId === undefined) {
    renderList(terminal, executionId, artifacts);
    return 0;
  }

  const summary = artifacts.find((artifact) => artifact.artifactId === artifactId);

  if (summary === undefined) {
    terminal.print(heading("Artifacts"));
    terminal.print(`No artifact "${artifactId}" on run ${executionId}.`);
    terminal.print();
    terminal.print(`Run  designflow artifacts ${executionId}  to see the ones that do exist.`);
    return 1;
  }

  const detail = await context.artifactInspection.getPayload(summary);
  renderDetail(terminal, detail.summary, detail.payload);
  return 0;
}

/**
 * Resolves a run's artifacts, or renders "no such run" and returns `null`.
 *
 * Excludes the unnamed, content-addressed payload entries the completion
 * screen also leaves out (`named` there) — each is the same stored bytes as
 * one of the logical artifacts already listed, under a hash instead of a
 * name, and showing both would look like twice as much happened.
 */
async function resolveArtifacts(
  context: CliContext,
  terminal: Terminal,
  executionId: string,
): Promise<readonly ArtifactSummary[] | null> {
  try {
    const report = await context.runner.explain(executionId);
    return report.artifacts.filter(
      (artifact) => artifact.name !== artifact.artifactId,
    );
  } catch {
    terminal.print(heading("Artifacts"));
    terminal.print(`No run with that id: ${executionId}`);
    terminal.print();
    terminal.print("Run  designflow history  to see runs that do exist.");
    return null;
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

  for (const artifact of artifacts) {
    terminal.print(`  ${artifact.artifactId}  ${artifact.name}  (${artifact.status})`);
  }

  terminal.print();
  terminal.print(`Inspect one:  designflow artifacts ${executionId} <artifact-id>`);
}

export function renderDetail(
  terminal: Terminal,
  summary: ArtifactSummary,
  payload: unknown,
): void {
  terminal.print(heading(summary.name));
  terminal.print();
  terminal.print("Stored internally by DesignFlow.");
  terminal.print("No project files were changed.");
  terminal.print();
  terminal.print(`Status: ${summary.status}`);

  if (summary.version !== undefined) {
    terminal.print(`Version: ${summary.version}`);
  }

  if (summary.dependencies.length > 0) {
    terminal.print(`Depends on: ${summary.dependencies.join(", ")}`);
  }

  terminal.print();
  renderPayload(terminal, payload);
}

/** A generated-source-code artifact, distinguished so its files print readably. */
interface SourceCodePayload {
  readonly framework: string;
  readonly files: readonly { readonly path: string; readonly contents: string }[];
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
    terminal.print(payload.files.length > 0 ? "Files:" : "(no files generated)");

    for (const file of payload.files) {
      terminal.print();
      terminal.print(file.path);
      terminal.print("-".repeat(Math.max(1, Math.min(file.path.length, 60))));
      printBounded(terminal, file.contents.length > 0 ? file.contents : "(empty file)");
    }

    return;
  }

  printBounded(terminal, JSON.stringify(payload, null, 2));
}

function printBounded(terminal: Terminal, text: string): void {
  const bounded = truncateForDisplay(text);
  terminal.print(bounded.text);

  if (bounded.truncated) {
    terminal.print(`… truncated (${bounded.totalLength - bounded.text.length} more characters)`);
  }
}
