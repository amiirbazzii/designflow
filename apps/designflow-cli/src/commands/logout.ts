import type { CliContext } from "../services/cli-runner";
import type { Terminal } from "../ui/terminal";

/** Clears local DesignFlow auth state without exposing session details. */
export async function logoutCommand(context: CliContext, terminal: Terminal): Promise<number> {
  await context.signOut();
  terminal.print("Signed out of DesignFlow AI on this device.");
  return 0;
}
