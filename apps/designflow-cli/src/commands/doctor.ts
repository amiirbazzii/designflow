import { heading, type Terminal } from "../ui/terminal";
import { runDoctor, type DoctorReport } from "../services/doctor";
import type { CliContext } from "../services/cli-runner";

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
    terminal.print();
    terminal.print("Doctor is read-only: it does not start workflows, consume approvals, send model requests, or mutate projects.");
  }
  return report.status === "failed" ? 1 : 0;
}
