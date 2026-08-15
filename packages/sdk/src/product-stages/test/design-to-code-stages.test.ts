// packages/sdk/src/product-stages/test/design-to-code-stages.test.ts
import { describe, expect, test } from "bun:test";

import {
  DESIGN_TO_CODE_AI_ROLES,
  DESIGN_TO_CODE_PRODUCT_STAGES,
  DESIGN_TO_CODE_STAGE_IDS,
  DESIGN_TO_CODE_V2_STAGE_BY_CAPABILITY,
  designToCodeStage,
  designToCodeStageForCapability,
} from "../design-to-code-stages";

// The flagship's actual node ids, mirrored here so a workflow change that
// adds or renames a node fails this test until the mapping catches up.
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

describe("the canonical Design-to-Code product stages", () => {
  test("order is strictly increasing and ids are unique", () => {
    const orders = DESIGN_TO_CODE_PRODUCT_STAGES.map((stage) => stage.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    expect(new Set(DESIGN_TO_CODE_PRODUCT_STAGES.map((stage) => stage.id)).size).toBe(
      DESIGN_TO_CODE_PRODUCT_STAGES.length,
    );
    expect(DESIGN_TO_CODE_PRODUCT_STAGES.map((stage) => stage.id)).toEqual([...DESIGN_TO_CODE_STAGE_IDS]);
  });

  test("vocabulary is product language, never architecture ids", () => {
    for (const stage of DESIGN_TO_CODE_PRODUCT_STAGES) {
      expect(stage.label).not.toMatch(/v2|workflow|node|compile-|-agent/i);
      expect(stage.description).not.toMatch(/design-to-code|v2-/);
    }
  });

  test("every flagship node maps to exactly one canonical stage", () => {
    for (const nodeId of FLAGSHIP_NODE_IDS) {
      const stage = designToCodeStageForCapability(nodeId);
      expect(stage).toBeDefined();
      expect(DESIGN_TO_CODE_STAGE_IDS).toContain(stage!);
    }
    // And the V2 map contains nothing that is not a flagship node.
    expect(Object.keys(DESIGN_TO_CODE_V2_STAGE_BY_CAPABILITY).sort()).toEqual([...FLAGSHIP_NODE_IDS].sort());
  });

  test("refining is conditional; done is terminal — neither pads the normal list", () => {
    expect(designToCodeStage("refining").normalVisible).toBe(false);
    expect(designToCodeStage("done").normalVisible).toBe(false);
    expect(designToCodeStage("review").normalVisible).toBe(true);
  });

  test("waiting for approval belongs to Review, applying to Applying", () => {
    expect(designToCodeStageForCapability("request-implementation-approval")).toBe("review");
    expect(designToCodeStageForCapability("create-project-snapshot")).toBe("applying");
    expect(designToCodeStageForCapability("apply-approved-file-changes")).toBe("applying");
    expect(designToCodeStageForCapability("run-project-validation")).toBe("applying");
  });

  test("historical capabilities still resolve, into the same vocabulary", () => {
    expect(designToCodeStageForCapability("invoke-figma-specification-agent")).toBe("understanding");
    expect(designToCodeStageForCapability("invoke-implementation-agent")).toBe("building");
    expect(designToCodeStageForCapability("apply-approved-correction")).toBe("refining");
    expect(designToCodeStageForCapability("never-existed")).toBeUndefined();
  });

  test("the four current AI roles, with their actual profile ids", () => {
    expect(DESIGN_TO_CODE_AI_ROLES.map((role) => role.label)).toEqual([
      "Design Interpreter",
      "Project Mapper",
      "UI Builder",
      "Visual Critic",
    ]);
    expect(DESIGN_TO_CODE_AI_ROLES.map((role) => role.profileId)).toEqual([
      "design-interpreter-default",
      "project-mapper-default",
      "ui-builder-default",
      "visual-critic-default",
    ]);
  });
});
