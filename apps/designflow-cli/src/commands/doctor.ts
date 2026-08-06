import { heading, type Terminal } from "../ui/terminal";
import { runDoctor, type DoctorReport } from "../services/doctor";
import type { CliContext } from "../services/cli-runner";
import {
  DESIGN_ENGINEER_READINESS_TITLE,
  type DesignEngineerReadiness,
  type JourneyReadiness,
} from "../services/readiness";

export { runDoctor } from "../services/doctor";
export type { DoctorCheck, DoctorReport, DoctorStatus } from "../services/doctor";

export async function doctorCommand(context: CliContext, terminal: Terminal, options: { readonly json?: boolean } = {}): Promise<number> {
  const report: DoctorReport = await runDoctor(context);
  if (options.json === true) {
    terminal.print(JSON.stringify(report, null, 2));
  } else {
    terminal.print(heading("Doctor"));
    terminal.print(`Overall status: ${report.status}`);
    terminal.print();
    for (const item of report.checks) {
      terminal.print(`[${item.status}] ${item.id}: ${item.detail}`);
      if (item.nextAction !== undefined) terminal.print(`  Next: ${item.nextAction}`);
    }
    printReadiness(terminal, report.readiness);
    terminal.print();
    terminal.print("Doctor is read-only: it does not start workflows, consume approvals, send model requests, or mutate projects.");
  }
  // Exit code comes from the checks alone. An incomplete setup — no
  // credential, no Figma connection, no project, no Playwright — is
  // reported, never treated as a failure; only a broken installation is.
  return report.status === "failed" ? 1 : 0;
}

function line(terminal: Terminal, label: string, item: { readonly detail: string; readonly nextStep?: string }): void {
  terminal.print(`  ${label}: ${item.detail}`);
  if (item.nextStep !== undefined) terminal.print(`    Next: ${item.nextStep}`);
}

function journey(terminal: Terminal, label: string, item: JourneyReadiness): void {
  terminal.print(`  ${label}: ${item.ready ? "ready" : "blocked"}`);
  for (const reason of item.reasons) terminal.print(`    Blocked by: ${reason}`);
  for (const note of item.notes) terminal.print(`    ${note}`);
}

function printReadiness(terminal: Terminal, readiness: DesignEngineerReadiness): void {
  terminal.print();
  terminal.print(heading(DESIGN_ENGINEER_READINESS_TITLE));
  line(terminal, "Model mode", { detail: readiness.modelMode === "live" ? `live — ${readiness.model.detail}` : `deterministic — ${readiness.model.detail}`, ...(readiness.model.nextStep !== undefined ? { nextStep: readiness.model.nextStep } : {}) });
  line(terminal, "Figma connection", readiness.figma);
  line(terminal, "Projects", readiness.projects);
  line(terminal, "Visual validation", readiness.visualValidation);
  terminal.print();
  journey(terminal, "Specification", readiness.specification);
  journey(terminal, "Implementation proposal", readiness.implementationProposal);
  terminal.print(`  Visual correction: ${readiness.visualCorrectionDetail}`);
}
