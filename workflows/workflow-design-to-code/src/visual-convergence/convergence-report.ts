// workflows/workflow-design-to-code/src/visual-convergence/convergence-report.ts
//
// A deterministic human-readable projection of one convergence record.
// It is a rendering of the artifact, never a source of truth.
import type { VisualConvergenceArtifact } from "@designflow/sdk";

const STOP_TEXT: Record<VisualConvergenceArtifact["stopReason"], string> = {
  converged: "Converged: no actionable visual differences remain.",
  acceptable_with_findings: "Acceptable with findings: only differences below the repair threshold remain.",
  iteration_limit_reached: "The iteration budget was spent.",
  no_measurable_improvement: "Stopped: a repair produced no measurable improvement.",
  regression_detected: "Stopped: a repair regressed overall quality.",
  render_inconclusive: "Stopped: visual evidence became unavailable, so no repair was attempted on a guess.",
  render_failed: "Stopped: a proposal could not be rendered.",
  builder_exhausted: "Stopped: the Builder produced no valid repair proposal.",
  map_unexecutable: "Stopped: the Implementation Map could not be executed.",
  project_changed: "Stopped: the project changed during refinement.",
  cancelled: "Cancelled.",
};

export function renderConvergenceReport(artifact: VisualConvergenceArtifact): string {
  const lines: string[] = ["Visual refinement", ""];

  for (const iteration of artifact.iterations) {
    lines.push(`Iteration ${iteration.iteration + 1}`);
    lines.push(`  ${iteration.quality.actionableCount} actionable difference${iteration.quality.actionableCount === 1 ? "" : "s"}`);
    if (iteration.quality.missingRequiredCount > 0)
      lines.push(`  ${iteration.quality.missingRequiredCount} required element${iteration.quality.missingRequiredCount === 1 ? "" : "s"} missing`);
    const comparison = iteration.comparison;
    if (comparison !== undefined) {
      if (comparison.resolved > 0) lines.push(`  ${comparison.resolved} resolved`);
      if (comparison.improved > 0) lines.push(`  ${comparison.improved} improved`);
      if (comparison.unchanged > 0) lines.push(`  ${comparison.unchanged} unchanged`);
      if (comparison.regressed > 0) lines.push(`  ${comparison.regressed} regressed`);
      if (comparison.introduced > 0) lines.push(`  ${comparison.introduced} newly introduced`);
    }
    lines.push("");
  }

  if (artifact.selectedIteration !== undefined) {
    lines.push(`Selected implementation`);
    lines.push(`  Iteration ${artifact.selectedIteration + 1}`);
    const last = artifact.iterations.at(-1);
    if (last !== undefined && artifact.selectedIteration !== last.iteration)
      lines.push(`  Iteration ${last.iteration + 1} was not selected; an earlier validated state measured better.`);
    lines.push("");
  } else {
    lines.push("No validated implementation state was selectable.");
    lines.push("");
  }

  lines.push("Result");
  lines.push(`  ${STOP_TEXT[artifact.stopReason]}`);
  return lines.join("\n");
}
