// workflows/workflow-design-to-code/src/flagship/test/flagship-guards.test.ts
//
// §69: the normal flagship source cannot reference a legacy Design-to-Code
// agent, and its workflow definition cannot contain a node that would invoke
// one. Legacy modules keep their own compatibility tests; this guard covers
// the flagship feature only.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { designToCodeV2Workflow } from "../flagship-workflow";
import { validateDestinationBinding, isConvergenceFinalizable } from "../flagship-capabilities";
import { MAP } from "../../v2-visual/test/support/spendly-v2-fixture";

const LEGACY_IDS = [
  "design-engineer-coordinator",
  "figma-specification-agent",
  "implementation-agent",
  "visual-validation-agent",
  "visual-correction-agent",
];

describe("flagship architecture guard (§69)", () => {
  test("no flagship real source references a legacy agent id", () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          if (entry !== "test") walk(path);
          continue;
        }
        if (!entry.endsWith(".ts")) continue;
        const contents = readFileSync(path, "utf8");
        for (const id of LEGACY_IDS) if (contents.includes(id)) offenders.push(`${entry} → ${id}`);
      }
    };
    walk(join(import.meta.dir, ".."));
    expect(offenders).toEqual([]);
  });

  test("no flagship workflow node invokes a legacy specialist capability", () => {
    const capabilityIds = designToCodeV2Workflow.nodes.map((node) => node.capabilityId);
    expect(capabilityIds).not.toContain("invoke-figma-specification-agent");
    expect(capabilityIds).not.toContain("invoke-implementation-agent");
    expect(capabilityIds).not.toContain("invoke-visual-validation-agent-stage5");
    expect(capabilityIds.some((id) => id.includes("correction"))).toBe(false);
    expect(capabilityIds.some((id) => id.includes("coordinator"))).toBe(false);
  });

  test("destination binding is deterministic and directional", () => {
    expect(validateDestinationBinding({ label: "App", kind: "page", path: "src/App.jsx" }, MAP)).toBeUndefined();
    expect(validateDestinationBinding({ label: "Settings", kind: "page", path: "src/Settings.jsx" }, MAP)).toContain(
      "the plan targets",
    );
    expect(
      validateDestinationBinding({ label: "Existing", kind: "component", sourcePath: "src/Other.jsx" }, MAP),
    ).toContain("never targets");
  });

  test("the finalization-eligibility policy is exactly the documented set (§17)", () => {
    expect(isConvergenceFinalizable("converged")).toBe(true);
    expect(isConvergenceFinalizable("converged_with_findings")).toBe(true);
    for (const status of [
      "exhausted",
      "inconclusive",
      "render_failed",
      "builder_failed",
      "map_unexecutable",
      "project_changed",
      "cancelled",
      "repair_required",
    ] as const)
      expect(isConvergenceFinalizable(status)).toBe(false);
  });
});
