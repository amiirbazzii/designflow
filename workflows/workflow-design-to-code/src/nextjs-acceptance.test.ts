// workflows/workflow-design-to-code/src/nextjs-acceptance.test.ts
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { validateProposedModules, inspectRegisteredProject, deriveImplementationCoveragePlan, mapDesignSystem } from "@designflow/capability-implementation";

/**
 * Realistic Next.js acceptance (post-release remediation, Part 9).
 *
 * These tests run against a REAL installed Next.js App Router fixture —
 * strict TypeScript, `@/*` alias, `src/app/add/page.tsx`, an existing
 * `src/components/Button.tsx`, `next.config.js` with the legacy
 * `experimental.outputFileTracingRoot` — the exact class of project that
 * produced mkdir('/private/var/Users') in the field. A fixture needs
 * node_modules installed, so the suite is gated on
 * DESIGNFLOW_NEXT_ACCEPTANCE_FIXTURE pointing at a prepared fixture root;
 * without it, the tests are skipped (the deterministic mechanics are covered
 * unconditionally in proposed-state-validation.test.ts).
 *
 * Prepare a fixture with:
 *   npx create-next-app (or the minimal layout in scripts/ docs) + npm install
 */

const FIXTURE = process.env["DESIGNFLOW_NEXT_ACCEPTANCE_FIXTURE"];
const available = FIXTURE !== undefined && existsSync(join(FIXTURE, "node_modules"));
const maybe = available ? test : test.skip;

const BUILD = { executable: "npm", args: ["run", "build"] } as const;

function proposal(files: Array<{ path: string; action: "create" | "modify"; content: string }>) {
  return {
    schemaVersion: "1", projectId: "next-fixture", baseProjectFingerprint: "f".repeat(64),
    files: files.map((file) => ({ ...file, reason: "acceptance", relatedDesignNodeIds: [] })),
    packageChanges: [], commandsRequested: [], assumptions: [], unresolvedItems: [],
  };
}

describe("Next.js proposed-state acceptance", () => {
  maybe("a valid new component passes proposed-state validation inside the workspace", async () => {
    const result = await validateProposedModules(FIXTURE!, proposal([{
      path: "src/components/AcceptanceNote.tsx", action: "create",
      content: "import React from \"react\";\n\nexport function AcceptanceNote({ text }: { text: string }) {\n  return <p>{text}</p>;\n}\n",
    }]), { buildCommand: BUILD, timeoutMs: 300_000 });
    expect(result.status).toBe("passed");
  }, 300_000);

  maybe("an existing-route modification reusing the existing Button passes", async () => {
    const result = await validateProposedModules(FIXTURE!, proposal([{
      path: "src/app/add/extra-panel.tsx", action: "create",
      content: "import { Button } from \"@/components/Button\";\n\nexport function ExtraPanel() {\n  return <section><Button label=\"Save\" /></section>;\n}\n",
    }]), { buildCommand: BUILD, timeoutMs: 300_000 });
    expect(result.status).toBe("passed");
  }, 300_000);

  maybe("a strict-mode implicit any is rejected with the exact diagnostic", async () => {
    const result = await validateProposedModules(FIXTURE!, proposal([{
      path: "src/components/BadItem.tsx", action: "create",
      content: "export function BadItem({ date }) {\n  return <li>{String(date)}</li>;\n}\n",
    }]), { buildCommand: BUILD, timeoutMs: 300_000 });
    expect(result.status).toBe("failed");
    expect(result.diagnostics.map((d) => d.message).join("\n")).toContain("implicitly has an 'any' type");
  }, 300_000);

  maybe("inspection discovers the existing Button and authorizes it for reuse", () => {
    const context = inspectRegisteredProject({ id: "next-fixture", name: "Next fixture", rootPath: FIXTURE! });
    expect(context.designSystem.components.map((component) => component.sourcePath)).toContain("src/components/Button.tsx");
    const spec = {
      schemaVersion: "2", sourceIdentity: { designFile: "file" }, frames: ["Add"], hierarchy: [{ id: "n1", name: "Add" }],
      designTokens: { colors: [], spacing: [], typography: [], radii: [], borders: [], shadows: [], referencedVariableNames: [] },
      components: [], layoutBehavior: [], responsiveAssumptions: [], assets: [], content: [], interactions: [], states: [],
      accessibilityNotes: [], ambiguities: [], agentVersion: "1",
    };
    const mapping = mapDesignSystem(spec as never, context);
    const plan = deriveImplementationCoveragePlan(spec, mapping, context);
    expect(plan.trustedReusePaths).toContain("src/components/Button.tsx");
  });
});
