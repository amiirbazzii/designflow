import { describe, expect, test } from "bun:test";
import type { ExecutionProgress } from "@designflow/product";
import { applyExecutionProgress, applyExecutionReport, applyExecutionUpdate, applySessionResult } from "./execution";
import { buildSessionView, setApprovalMode } from "./model";

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

  test("shows managed-mode escalation as review required rather than an automatic approval", () => {
    const session = setApprovalMode(buildSessionView({ figma: "connected", ai: "connected" }), "designflow");
    const next = applyExecutionProgress(session, {
      completed: 0,
      total: 1,
      percent: 0,
      steps: [],
      approval: "waiting",
    });

    expect(next.approval.status).toBe("needs-review");
    expect(next.activity[0]).toMatchObject({ actor: "designflow", title: "Needs your review" });
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

  // DF-SPEC-06: the candidate chain travels as structured report facts, not
  // as prose inside the failure message, so Details can render it per model.
  test("an exhausted candidate chain reaches Details with per-candidate facts", () => {
    const failed = applyExecutionReport(session(), {
      overview: {
        state: "failed",
        status: "failed",
        executionId: "926a8b19-7f58-4651-b229-97fa006b4906",
        failure: {
          errorCode: "ERR_MODEL_CANDIDATES_EXHAUSTED",
          failedCapabilityId: "invoke-figma-specification-agent",
          modelCandidates: [
            { model: "openai/gpt-4o-mini", code: "ERR_MODEL_TIMEOUT", durationMs: 145000 },
            { model: "openai/gpt-5.6-luna", code: "ERR_MODEL_UNAVAILABLE", durationMs: 812, reason: "requested model is unavailable: not a valid model ID" },
          ],
        },
      },
      artifacts: [],
    });

    const details = failed.technicalDetails.join("\n");
    expect(details).toContain("Candidates tried");
    expect(details).toContain("1. openai/gpt-4o-mini");
    expect(details).toContain("Duration: 145000ms");
    expect(details).toContain("Reason: requested model is unavailable: not a valid model ID");
    expect(details).toContain("Run id: 926a8b19-7f58-4651-b229-97fa006b4906");
  });

  test("model-unreachable terminal facts clear the active workflow state", () => {
    const failed = applyExecutionReport(session(), {
      overview: {
        state: "failed",
        status: "failed",
        failure: { errorCode: "ERR_MODEL_SERVICE_UNAVAILABLE", failedCapabilityId: "invoke-implementation-agent" },
      },
      artifacts: [],
    });

    expect(failed.workflow.status).toBe("unavailable");
    expect(failed.finalResult?.status).toBe("failure");
    expect(failed.activity[0]).toMatchObject({ actor: "designflow", title: "Needs attention", state: "failed" });
  });
});

describe("Phase 6B technical details reach the session view (DF-TUI-06)", () => {
  test("a failed report populates technicalDetails with code, step, safe cause, and run id", () => {
    const failed = applyExecutionReport(session(), {
      overview: {
        executionId: "c6fda8f4-9862-4aee-a900-df3e71f15e32",
        state: "failed",
        status: "failed",
        failure: {
          errorCode: "ERR_MCP_TOOL_FAILED",
          failedCapabilityId: "retrieve-figma-source-snapshot",
          message: "No node could be found for the provided nodeId: 1026:6098. Make sure the Figma desktop app is open and the document containing the node is the active tab.",
        },
      },
      artifacts: [],
    });
    const details = failed.technicalDetails.join("\n");
    expect(details).toContain("Error code: ERR_MCP_TOOL_FAILED");
    expect(details).toContain("retrieve-figma-source-snapshot");
    expect(details).toContain("nodeId: 1026:6098");
    expect(details).toContain("Run id: c6fda8f4-9862-4aee-a900-df3e71f15e32");
    // the concise outcome summary must not absorb the technical cause
    expect(failed.diagnostics.join("\n")).not.toContain("nodeId: 1026:6098");
    // presenting a report never mutates workflow forward state
    expect(failed.workflow.status).toBe("unavailable");
    expect(failed.finalResult?.status).toBe("failure");
  });

  test("a failed report without failure facts leaves technicalDetails bounded and safe", () => {
    const failed = applyExecutionReport(session(), {
      overview: { state: "failed", status: "failed" },
      artifacts: [],
    });
    expect(Array.isArray(failed.technicalDetails)).toBe(true);
    expect(failed.technicalDetails.some((line) => line.includes("undefined"))).toBe(false);
  });
});

describe("DF-CORR-01 stage truthfulness on completion", () => {
  test("a completed run marks only stages that ran; correction stays pending", () => {
    let view = session();
    view = applyExecutionProgress(view, {
      steps: [
        { capabilityId: "parse-figma-source", label: "Parse", status: "done" },
        { capabilityId: "invoke-implementation-agent", label: "Implement", status: "done" },
      ],
    } as never);
    const completed = applyExecutionUpdate(view, { status: "completed" });
    const byId = new Map(completed.workflow.stages.map((stage) => [stage.id, stage.status]));
    expect(byId.get("understanding")).toBe("complete");
    expect(byId.get("implementation")).toBe("complete");
    expect(byId.get("correction")).toBe("pending");
    expect(byId.get("visual-check")).toBe("pending");
  });
});
