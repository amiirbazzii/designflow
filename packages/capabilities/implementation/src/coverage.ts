import {
  designSpecificationSchema,
  designSystemMappingSchema,
  implementationCoveragePlanV1Schema,
  MAX_IMPLEMENTATION_COVERAGE_TARGETS,
  projectImplementationContextV1Schema,
  type ImplementationCoverageClaim,
  type ImplementationCoveragePlanV1,
  type ProposedFileChanges,
} from "@designflow/sdk";
import { ImplementationError } from "./errors";
import { isExecutableSourcePath } from "./proposed-state-validation";

/**
 * Deterministic Implementation Coverage Contract (MVP-4O). The host derives
 * the required design surface from already-persisted structured evidence —
 * the selected root frame and reuse-mapped design components — and the
 * model must declare, per required target, which proposal files
 * (`proposed_change`) or trusted mapped existing files (`existing_reuse`)
 * satisfy it. The host is authoritative over targets, trusted reuse paths,
 * and file classification; the model only chooses among allowed paths.
 * Coverage proves the proposal addresses the requested surface — never that
 * the implementation is visually correct.
 */

export interface CoverageValidationResult {
  readonly status: "passed";
  readonly satisfiedTargets: readonly { readonly targetId: string; readonly mode: string; readonly paths: readonly string[] }[];
}

/**
 * Derives the bounded required-target plan. Precedence: the selected root
 * frame (always required, from the specification hierarchy's parentless
 * node, falling back to the first node), then reuse-mapped design
 * components in mapping order whose reference resolves to a trusted
 * inspected component source path, up to the fixed bound.
 */
export function deriveImplementationCoveragePlan(rawSpec: unknown, rawMapping: unknown, rawProject: unknown): ImplementationCoveragePlanV1 {
  const spec = designSpecificationSchema.parse(rawSpec);
  const mapping = designSystemMappingSchema.parse(rawMapping);
  const project = projectImplementationContextV1Schema.parse(rawProject);
  const root = spec.hierarchy.find((node) => node.parentId === undefined) ?? spec.hierarchy[0];
  if (root === undefined) throw new ImplementationError("ERR_COVERAGE_PLAN_UNAVAILABLE", "The design specification carries no hierarchy; a coverage plan cannot be derived.");
  const componentPathByName = new Map(project.designSystem.components.map((component) => [component.name, component.sourcePath]));
  const trustedReusePaths = [...new Set(project.designSystem.components.map((component) => component.sourcePath))];
  const targets: ImplementationCoveragePlanV1["requiredTargets"][number][] = [
    { id: `frame:${root.id}`, kind: "root_frame", requirement: "required", source: "figma-selection", name: root.name, mappedProjectPaths: [] },
  ];
  for (const candidate of mapping.componentMappings) {
    if (targets.length >= MAX_IMPLEMENTATION_COVERAGE_TARGETS) break;
    if (candidate.action !== "reuse" || candidate.projectComponentReference === undefined) continue;
    const mappedPath = componentPathByName.get(candidate.projectComponentReference);
    if (mappedPath === undefined) continue;
    const id = `component:${candidate.designComponentId}`;
    if (targets.some((target) => target.id === id)) continue;
    targets.push({ id, kind: "component", requirement: "required", source: "design-system-mapping", name: candidate.designComponentId, mappedProjectPaths: [mappedPath] });
  }
  return implementationCoveragePlanV1Schema.parse({ schemaVersion: "1", targetFrame: { nodeId: root.id, name: root.name }, requiredTargets: targets, trustedReusePaths });
}

function fail(code: "ERR_PROPOSAL_COVERAGE_INCOMPLETE" | "ERR_PROPOSAL_COVERAGE_INVALID", message: string, metadata: Record<string, unknown>): never {
  throw new ImplementationError(code, message, metadata);
}

/**
 * Validates the model's coverage claims against the host plan and the exact
 * proposal. Runs after structural/content-integrity validation and BEFORE
 * proposed-state compilation, so an uncovered proposal never costs a build
 * and never reaches approval.
 */
export function validateImplementationCoverage(plan: ImplementationCoveragePlanV1, proposal: ProposedFileChanges, claims: readonly ImplementationCoverageClaim[]): CoverageValidationResult {
  const proposalPaths = new Set(proposal.files.filter((file) => file.action !== "delete").map((file) => file.path));
  const trusted = new Set(plan.trustedReusePaths);
  const targetIds = new Set(plan.requiredTargets.map((target) => target.id));
  for (const claim of claims) {
    if (!targetIds.has(claim.targetId)) fail("ERR_PROPOSAL_COVERAGE_INVALID", `Coverage claim references an unknown target: ${claim.targetId}`, { targetId: claim.targetId, fact: "the host-derived coverage plan does not contain this target" });
    for (const path of [...claim.paths, ...claim.supportingPaths]) {
      if (path.startsWith("/") || path.includes("\\") || path.split("/").includes("..")) fail("ERR_PROPOSAL_COVERAGE_INVALID", `Coverage claim path is not a safe project-relative path: ${path}`, { targetId: claim.targetId, path, fact: "coverage paths must be project-relative" });
    }
    if (claim.mode === "proposed_change") {
      for (const path of claim.paths) if (!proposalPaths.has(path)) fail("ERR_PROPOSAL_COVERAGE_INVALID", `Coverage claim references a file that is not part of the proposal: ${path}`, { targetId: claim.targetId, mode: claim.mode, path, fact: "proposed_change paths must occur in the exact proposal" });
    } else {
      for (const path of claim.paths) if (!trusted.has(path)) fail("ERR_PROPOSAL_COVERAGE_INVALID", `Coverage claim reuses a path outside the trusted implementation mapping: ${path}`, { targetId: claim.targetId, mode: claim.mode, path, fact: "path is not present in trusted implementation mapping" });
    }
  }
  const satisfied: { targetId: string; mode: string; paths: readonly string[] }[] = [];
  for (const target of plan.requiredTargets) {
    const targetClaims = claims.filter((claim) => claim.targetId === target.id);
    if (targetClaims.length === 0) fail("ERR_PROPOSAL_COVERAGE_INCOMPLETE", `The proposal does not cover required design target ${target.id}.`, { targetId: target.id, targetKind: target.kind, fact: target.kind === "root_frame" ? "the selected design root requires executable implementation coverage" : "this mapped design component requires a coverage claim" });
    const valid = targetClaims.find((claim) => claim.paths.some((path) => isExecutableSourcePath(path)));
    if (valid === undefined) fail("ERR_PROPOSAL_COVERAGE_INVALID", `Coverage for ${target.id} has no executable primary path.`, { targetId: target.id, targetKind: target.kind, path: targetClaims[0]!.paths[0], fact: target.kind === "root_frame" ? "root-frame coverage requires executable UI source" : "component coverage requires executable UI source" });
    satisfied.push({ targetId: target.id, mode: valid.mode, paths: valid.paths });
  }
  return { status: "passed", satisfiedTargets: satisfied };
}
