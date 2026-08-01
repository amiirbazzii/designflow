// apps/designflow-cli/src/live-openrouter.test.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { createCliContext } from "./services/cli-runner";
import type { CliContext } from "./services/cli-runner";

/**
 * The one test in this codebase permitted to reach the real OpenRouter API.
 *
 * Gated behind two environment variables, both required, so it can never run
 * by accident:
 *
 *   OPENROUTER_API_KEY          a real credential
 *   DESIGNFLOW_LIVE_MODEL_TEST=1  explicit opt-in, separate from having a key
 *
 * Standard CI and every local `bun test` run skip this file entirely — no
 * network access, no cost, nothing gated on a secret being present. It exists
 * for a person who wants to confirm, by hand, that the configured profile
 * still resolves to a model that actually answers.
 *
 * The model comes from `createCliContext`'s own wiring — the Design
 * Engineer's real, configured profile — never a slug hardcoded in this file.
 * "Best model" selection is exactly what this stage was told not to add, and
 * a test picking its own model would be a second place that decision lives.
 */

const canRunLive =
  process.env["OPENROUTER_API_KEY"] !== undefined &&
  process.env["OPENROUTER_API_KEY"].trim().length > 0 &&
  process.env["DESIGNFLOW_LIVE_MODEL_TEST"] === "1";

const workspaces: string[] = [];
const contexts: CliContext[] = [];

afterEach(() => {
  for (const created of contexts.splice(0)) created.close();
  for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
  delete process.env["DESIGNFLOW_HOME"];
});

describe.skipIf(!canRunLive)("a live OpenRouter call", () => {
  test("the configured profile answers a small, bounded, non-sensitive request", async () => {
    const home = mkdtempSync(join(tmpdir(), "designflow-live-"));
    workspaces.push(home);
    process.env["DESIGNFLOW_HOME"] = home;

    const context = createCliContext({
      databasePath: join(home, "runs.json"),
      requireApproval: false,
    });
    contexts.push(context);

    const assignment = context.modelAssignments.find(
      (candidate) => candidate.workerName === "Design Engineer",
    );

    if (assignment === undefined) {
      throw new Error("expected a Design Engineer model assignment to be configured");
    }

    // A small, generic, non-sensitive request — nothing project-specific,
    // nothing that names a real file, a real customer, or any content beyond
    // what proves the round trip works.
    const { decision } = await context.routeTask({
      workerId: "design-engineer",
      request: "build a simple button component",
      input: { designFile: "example.fig" },
    });

    // Reported to the terminal running this by hand: the safe facts only.
    // Never the request, never a completion, never the credential.
    process.stdout.write(
      `live model check — model: ${assignment.model}, decision: ${decision.type}\n`,
    );

    expect(["run_workflow", "request_clarification", "decline"]).toContain(decision.type);
  }, 30_000);
});

describe.skipIf(canRunLive)("live OpenRouter test (skipped)", () => {
  test("requires both OPENROUTER_API_KEY and DESIGNFLOW_LIVE_MODEL_TEST=1", () => {
    // Documents why the suite above did not run, for anyone reading test
    // output without having read this file.
    expect(canRunLive).toBe(false);
  });
});
