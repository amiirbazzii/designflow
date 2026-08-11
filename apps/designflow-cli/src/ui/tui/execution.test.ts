import { describe, expect, test } from "bun:test";
import type { ExecutionProgress } from "@designflow/product";
import { applyExecutionProgress, applyExecutionReport, applyExecutionUpdate, applySessionResult } from "./execution";
import { buildSessionView } from "./model";

const progress = (steps: ExecutionProgress["steps"]): ExecutionProgress => ({
  completed: steps.filter((step) => step.status === "done").length,
  total: steps.length,
  percent: steps.length === 0 ? 0 : Math.round((steps.filter((step) => step.status === "done").length / steps.length) * 100),
  steps,
});

const session = () => buildSessionView({ figma: "connected", ai: "connected", project: { name: "Spendly" } });

describe("live workflow presentation adapter", () => {
  test("maps typed progress into stable product stage order and active stage", () => {
    const next = applyExecutionProgress(session(), progress([
      { capabilityId: "parse-figma-source", label: "Parse Figma source", status: "done" },
      { capabilityId: "invoke-figma-specification-agent", label: "Invoke Figma specification agent", status: "active", attempt: 1, maxAttempts: 1 },
      { capabilityId: "inspect-registered-project", label: "Inspect registered project", status: "pending" },
    ]));

    expect(next.workflow.stages.map((stage) => stage.label)).toEqual([
      "Understanding", "Specification", "Project analysis", "Implementation", "Validation", "Visual check", "Correction",
    ]);
    expect(next.workflow.activeStage).toBe("specification");
    expect(next.workflow.stages[0]?.status).toBe("complete");
    expect(next.workflow.stages[1]?.status).toBe("active");
    expect(next.activity[0]).toMatchObject({ actor: "designflow", state: "completed" });
    expect(next.activity[1]).toMatchObject({ actor: "specification-ai", detail: "Reading design evidence", state: "running" });
    expect(next.attempt).toEqual({ current: 1, maximum: 1 });
  });

  test("keeps AI and deterministic work distinct and exposes validation checks", () => {
    const next = applyExecutionProgress(session(), progress([
      { capabilityId: "invoke-implementation-agent", label: "Invoke implementation agent", status: "done" },
      { capabilityId: "run-project-validation", label: "Run project validation", status: "active" },
    ]));

    expect(next.activity.map((item) => item.actor)).toEqual(["implementation-ai", "designflow"]);
    expect(next.checks).toEqual([{ id: "run-project-validation", label: "Run project validation", status: "running" }]);
  });

  test("does not mutate the source presentation model", () => {
    const before = session();
    applyExecutionProgress(before, progress([{ capabilityId: "parse-figma-source", label: "Parse Figma source", status: "active" }]));
    expect(before.workflow.status).toBe("idle");
    expect(before.activity[0]?.title).toBe("Ready to start");
  });

  test("renders safe cancellation, clarification, and decline outcomes", () => {
    const cancelled = applyExecutionUpdate(session(), { status: "cancelled" });
    expect(cancelled.activity[0]?.title).toBe("Cancelled");

    const waiting = applySessionResult(session(), {
      session: { status: "waiting_for_user", currentQuestion: "Which route?" } as never,
      message: "Which route should be prepared?",
    });
    expect(waiting.activity[0]).toMatchObject({ actor: "designflow", title: "More information needed" });
    expect(waiting.diagnostics).toEqual(["Which route should be prepared?"]);

    const declined = applySessionResult(session(), {
      session: { status: "declined" } as never,
      message: "This request was declined.",
    });
    expect(declined.finalResult?.status).toBe("failure");
  });

  test("adds output entries only for real artifacts and uses curated failure wording", () => {
    const ready = applyExecutionReport(session(), {
      overview: { state: "ready", status: "completed" },
      artifacts: [
        { artifactId: "design-specification", name: "Specification", type: "design.specification", status: "created", dependencies: [] },
        { artifactId: "unknown-internal-payload", name: "Internal payload", type: "internal.payload", status: "created", dependencies: [] },
      ],
    });
    expect(ready.outputs.map((output) => output.label)).toEqual(["Specification", "Internal payload"]);
    expect(ready.outputs[0]).toMatchObject({ kind: "specification", viewerType: "specification", artifactRef: { artifactId: "design-specification" } });

    const failed = applyExecutionReport(session(), {
      overview: {
        state: "failed",
        status: "failed",
        failure: { errorCode: "ERR_PROPOSAL_ATTEMPTS_EXHAUSTED", failedCapabilityId: "invoke-implementation-agent" },
      },
      artifacts: [],
    });
    expect(failed.finalResult?.status).toBe("failure");
    expect(failed.diagnostics.join(" ")).toContain("safe change");
  });
});
