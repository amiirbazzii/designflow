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
      "Understanding", "Planning", "Building", "Checking", "Review", "Applying",
    ]);
    // Both legacy capabilities map into the canonical Understanding stage,
    // which therefore stays active while its second step runs.
    expect(next.workflow.activeStage).toBe("understanding");
    expect(next.workflow.stages[0]?.status).toBe("active");
    expect(next.workflow.stages[1]?.status).toBe("pending");
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

describe("V2-10 corrective follow-up: AI readiness and semantic degradation presentation", () => {
  const blueprintArtifact = (semanticEnrichment: "enriched" | "unavailable" | "not_requested") => ({
    artifactId: "ui-blueprint",
    name: "UI Blueprint",
    type: "design.ui-blueprint",
    status: "created" as const,
    dependencies: [],
    semanticEnrichment,
  });

  test("Design Interpreter degradation is visible without exposing model/gateway detail, and Understanding is not marked failed", () => {
    // Reproduces the first half of the V2-10 field defect (executionId
    // 0506a14f-a052-4ff7-a0ce-95ad40126677): Design Interpreter exhausted
    // every model candidate with ERR_MODEL_ROUTE_NOT_FOUND, and the
    // deterministic Blueprint compiler completed anyway.
    const next = applyExecutionReport(session(), {
      overview: { state: "ready", status: "completed" },
      artifacts: [blueprintArtifact("unavailable")],
    });

    const understanding = next.workflow.stages.find((stage) => stage.id === "understanding");
    expect(understanding?.status).toBe("needs-attention");
    expect(understanding?.note).toBe("AI semantic enrichment unavailable");
    // Normal presentation names the degraded capability, never the
    // technical cause — no model id, error code, or gateway detail.
    expect(understanding?.note).not.toMatch(/gpt|ERR_|route|gateway/i);
    // The run itself still reads as successful — degradation is additive,
    // not a failure of Understanding.
    expect(next.finalResult?.status).toBe("success");
  });

  test("a subsequent required-role failure does not erase the Understanding degradation note, and zero legacy fallback occurs", () => {
    // Reproduces the full V2-10 scenario: Design Interpreter degrades, then
    // Project Mapper exhausts every candidate the same way and the whole
    // run fails. Understanding's note must survive a later-stage failure.
    const next = applyExecutionReport(session(), {
      overview: {
        state: "failed",
        status: "failed",
        failure: { errorCode: "ERR_PROJECT_MAPPER_UNAVAILABLE", failedCapabilityId: "map-v2-project" },
      },
      artifacts: [blueprintArtifact("unavailable")],
    });

    const understanding = next.workflow.stages.find((stage) => stage.id === "understanding");
    expect(understanding?.status).toBe("needs-attention");
    expect(understanding?.note).toBe("AI semantic enrichment unavailable");

    // Required-role failure presentation: AI service availability, not a
    // project/mapping-correctness claim, and no legacy-agent language.
    expect(next.diagnostics[0]).toBe("Implementation could not be safely planned.");
    expect(next.diagnostics.join(" ")).toMatch(/DesignFlow AI could not run Project Mapper/);
    expect(next.diagnostics.join(" ")).not.toMatch(/coordinator|specification agent|implementation agent/i);
  });

  test("enriched Blueprint carries no degradation note", () => {
    const next = applyExecutionReport(session(), {
      overview: { state: "ready", status: "completed" },
      artifacts: [blueprintArtifact("enriched")],
    });
    const understanding = next.workflow.stages.find((stage) => stage.id === "understanding");
    expect(understanding?.note).toBeUndefined();
    expect(understanding?.status).not.toBe("needs-attention");
  });

  test("resumed-session reconstruction: a fresh session fed the same persisted artifact reproduces the identical degraded presentation", () => {
    // The degradation fact comes from the durable artifact summary
    // (`semanticEnrichment`, backed by the Blueprint's persisted
    // `metadata.semanticStatus`), not from any ephemeral error event — so a
    // brand-new session view fed the same report reconstructs identically,
    // exactly as re-opening a resumed session would.
    const liveRun = applyExecutionReport(session(), {
      overview: { state: "ready", status: "completed" },
      artifacts: [blueprintArtifact("unavailable")],
    });
    const resumedSession = applyExecutionReport(session(), {
      overview: { state: "ready", status: "completed" },
      artifacts: [blueprintArtifact("unavailable")],
    });

    const understandingOf = (view: typeof liveRun) => view.workflow.stages.find((stage) => stage.id === "understanding");
    expect(understandingOf(resumedSession)).toEqual(understandingOf(liveRun));
  });
});

describe("DF-CORR-01 stage truthfulness on completion", () => {
  test("a completed run marks only stages that ran; correction stays pending", () => {
    let view = session();
    view = applyExecutionProgress(view, {
      steps: [
        { capabilityId: "parse-figma-source", label: "Parse", status: "done" },
        { capabilityId: "build-v2-implementation", label: "Build", status: "done" },
      ],
    } as never);
    const completed = applyExecutionUpdate(view, { status: "completed" });
    const byId = new Map(completed.workflow.stages.map((stage) => [stage.id, stage.status]));
    expect(byId.get("understanding")).toBe("complete");
    expect(byId.get("building")).toBe("complete");
    // Stages that never ran are not claimed, and the conditional Refining
    // stage is not even a row when no refinement was observed (§54).
    expect(byId.get("checking")).toBe("pending");
    expect(byId.has("refining")).toBe(false);
  });
});
