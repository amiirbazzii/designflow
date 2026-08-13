import { type ProposedFileChanges, type Stage4ProjectImplementationContext } from "@designflow/sdk";
import { applyProjectFileChanges, rollbackProjectSnapshot, type ApplicationResult } from "./project-mutation/application";
import { validateProject, makeValidationReport, type ValidationOptions } from "./validation/validation";
import { ImplementationError } from "./errors";

export async function applyAndValidateProject(options: { projectId: string; root: string; rootIdentity: string; stateDirectory: string; proposal: ProposedFileChanges; context: Stage4ProjectImplementationContext; proposalArtifactId: string; applicationArtifactId: string; validationArtifactId: string; validation?: ValidationOptions }): Promise<{ application: ApplicationResult; report: ReturnType<typeof makeValidationReport> }> {
  const application = await applyProjectFileChanges(options.projectId, options.root, options.proposal, options.rootIdentity, options.stateDirectory);
  try {
    const checks = await validateProject(options.context, options.root, options.validation);
    const failedRequired = checks.some((check) => check.required && check.status !== "passed");
    if (failedRequired) { await rollbackProjectSnapshot(options.root, application.snapshot); return { application, report: makeValidationReport({ projectId: options.projectId, proposalArtifactId: options.proposalArtifactId, applicationArtifactId: options.applicationArtifactId, checks, passed: false, rollbackTriggered: true, rollbackArtifactId: `${application.runId}-rollback`, warnings: ["A required validation check failed; the project was restored."] }) }; }
    return { application, report: makeValidationReport({ projectId: options.projectId, proposalArtifactId: options.proposalArtifactId, applicationArtifactId: options.applicationArtifactId, checks, passed: true, rollbackTriggered: false, warnings: [] }) };
  } catch (error) { try { await rollbackProjectSnapshot(options.root, application.snapshot); } catch { throw new ImplementationError("ERR_ROLLBACK_FAILED", "Implementation failed and automatic rollback could not fully restore the project."); } throw error; }
}
