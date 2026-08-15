// apps/designflow-cli/src/ui/tui/stage-derivation.test.ts
//
// V2-9: the TUI derives every stage fact from the one canonical SDK source,
// and no presentation module keeps an independent Design-to-Code stage list.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DESIGN_TO_CODE_PRODUCT_STAGES } from "@designflow/sdk";

import { DESIGNFLOW_WORKFLOW_STAGES, buildSessionView } from "../model";
import { applyExecutionProgress, LIVE_STAGE_ORDER, stageForCapability } from "../execution";

const FLAGSHIP_NODE_IDS = [
  "parse-figma-source",
  "retrieve-figma-source-snapshot",
  "compile-v2-blueprint",
  "compile-v2-project-context",
  "map-v2-project",
  "build-v2-implementation",
  "run-visual-convergence",
  "assert-v2-finalizable",
  "inspect-finalization-project",
  "resolve-selected-proposal",
  "store-final-review",
  "request-implementation-approval",
  "create-project-snapshot",
  "apply-approved-file-changes",
  "run-project-validation",
  "store-finalization-result",
];

function progress(steps: readonly { capabilityId: string; status: "done" | "active" | "pending" }[], approval?: "waiting") {
  return {
    steps: steps.map((step) => ({ ...step, label: step.capabilityId })),
    ...(approval !== undefined ? { approval } : {}),
  } as never;
}

describe("stage derivation from the canonical source (V2-9)", () => {
  test("the initial list and the live order both come from the SDK stages", () => {
    const canonicalVisible = DESIGN_TO_CODE_PRODUCT_STAGES.filter((stage) => stage.normalVisible);
    expect(DESIGNFLOW_WORKFLOW_STAGES.map((stage) => stage.id)).toEqual(canonicalVisible.map((stage) => stage.id));
    expect(LIVE_STAGE_ORDER).toEqual(canonicalVisible.map((stage) => stage.id));
  });

  test("every flagship node resolves to a canonical stage — no raw ids in normal output", () => {
    for (const nodeId of FLAGSHIP_NODE_IDS) expect(stageForCapability(nodeId)).toBeDefined();
  });

  test("Refining appears only when a run actually reached it (§54)", () => {
    const session = buildSessionView({ figma: "connected", ai: "connected" });
    const normal = applyExecutionProgress(session, progress([
      { capabilityId: "compile-v2-blueprint", status: "done" },
      { capabilityId: "run-visual-convergence", status: "active" },
    ]));
    expect(normal.workflow.stages.some((stage) => stage.id === "refining")).toBe(false);

    // A historical correction run observed refining work — the stage appears.
    const legacy = applyExecutionProgress(session, progress([
      { capabilityId: "apply-approved-correction", status: "done" },
    ]));
    expect(legacy.workflow.stages.some((stage) => stage.id === "refining")).toBe(true);
  });

  test("needs_approval is the Review stage, not Applying (§55)", () => {
    const session = buildSessionView({ figma: "connected", ai: "connected" });
    const waiting = applyExecutionProgress(session, progress([
      { capabilityId: "store-final-review", status: "done" },
      { capabilityId: "request-implementation-approval", status: "done" },
    ], "waiting"));
    expect(waiting.workflow.activeStage).toBe("review");
    expect(waiting.workflow.stages.find((stage) => stage.id === "review")?.status).toBe("active");
    expect(waiting.workflow.stages.find((stage) => stage.id === "applying")?.status).toBe("pending");
  });

  test("after approval, apply/validation own the Applying stage (§57)", () => {
    const session = buildSessionView({ figma: "connected", ai: "connected" });
    const applying = applyExecutionProgress(session, progress([
      { capabilityId: "request-implementation-approval", status: "done" },
      { capabilityId: "create-project-snapshot", status: "done" },
      { capabilityId: "apply-approved-file-changes", status: "active" },
    ]));
    expect(applying.workflow.activeStage).toBe("applying");
  });

  test("no presentation module re-declares an independent stage list (§69)", () => {
    // The two historically duplicated files must now import the canonical
    // source and must not re-introduce a literal ordered stage array.
    for (const file of ["execution.ts", "model.ts"]) {
      const contents = readFileSync(join(import.meta.dir, "..", file), "utf8");
      expect(contents).toContain("DESIGN_TO_CODE_PRODUCT_STAGES");
      expect(contents).not.toMatch(/"understanding",\s*\n\s*"specification"/);
      expect(contents).not.toMatch(/label: "Understanding", status: "pending"/);
    }
    const presentation = readFileSync(join(import.meta.dir, "..", "..", "..", "services", "presentation.ts"), "utf8");
    expect(presentation).toContain("DESIGN_TO_CODE_PRODUCT_STAGES");
  });
});
