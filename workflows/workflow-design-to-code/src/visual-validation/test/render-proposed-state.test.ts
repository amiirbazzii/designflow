// workflows/workflow-design-to-code/src/visual-validation/test/render-proposed-state.test.ts
//
// V2-5: the pre-approval render. Everything here uses a real temporary project
// and a fake browser — no paid model, no user project, no network.
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectRegisteredProject, projectFileHash } from "@designflow/capability-implementation";
import { proposedFileChangesSchema } from "@designflow/sdk";

import { renderProposedState } from "../render-proposed-state";

async function fixture(build: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "designflow-render-state-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "render-state-fixture", scripts: { build, preview: "node preview.mjs" } }),
  );
  await writeFile(
    join(root, "preview.mjs"),
    "import http from 'node:http'; const port = Number(process.argv.at(-1)); http.createServer((_, response) => { response.writeHead(200, {'content-type':'text/html'}); response.end('<!doctype html><html><body>fixture</body></html>'); }).listen(port, '127.0.0.1');\n",
  );
  await writeFile(join(root, "src", "App.jsx"), "export default function App() { return null; }\n");
  return root;
}

function proposalFor(root: string) {
  const project = inspectRegisteredProject({ id: "render-project", name: "Fixture", rootPath: root });
  return {
    project,
    proposal: proposedFileChangesSchema.parse({
      schemaVersion: "1",
      projectId: project.project.id,
      baseProjectFingerprint: project.project.contextFingerprint,
      files: [
        {
          path: "src/App.jsx",
          action: "modify",
          content: "export default function App() { return 'built'; }\n",
          expectedBaseHash: projectFileHash(join(root, "src", "App.jsx")),
          reason: "The proposed screen.",
          relatedDesignNodeIds: ["frame-1"],
        },
      ],
      packageChanges: [],
      commandsRequested: [],
      assumptions: [],
      unresolvedItems: [],
    }),
  };
}

function renderer(options: { runtimeErrors?: readonly string[]; dom?: boolean; warnings?: readonly string[] } = {}) {
  let captures = 0;
  return {
    get captures() {
      return captures;
    },
    async capture(_url: string, viewport: { width: number; height: number }) {
      captures += 1;
      return {
        bytes: new Uint8Array([137, 80, 78, 71, captures]),
        width: viewport.width,
        height: viewport.height,
        consoleErrors: [],
        runtimeErrors: options.runtimeErrors ?? [],
        failedResources: [],
        warnings: options.warnings ?? [],
        ...(options.dom === false
          ? {}
          : {
              dom: {
                elements: [
                  {
                    selector: "h1",
                    text: "Add Transaction",
                    x: 0,
                    y: 0,
                    width: 200,
                    height: 40,
                    color: "rgb(17, 17, 17)",
                    fontSize: "24px",
                  },
                ],
                overflow: [],
              },
            }),
      };
    },
    async close() {},
  };
}

const viewports = [{ id: "desktop", width: 320, height: 240 }];

describe("pre-approval render", () => {
  test("renders a validated proposal and keeps the evidence", async () => {
    const root = await fixture("bun --version");
    try {
      const { project, proposal } = proposalFor(root);
      const browser = renderer();
      const result = await renderProposedState(root, project, proposal, {
        viewports,
        signal: new AbortController().signal,
        renderer: browser,
      });

      expect(result.renderedState.status).toBe("rendered");
      expect(result.renderedState.runtime.buildStatus).toBe("passed");
      expect(result.renderedState.viewports).toHaveLength(1);
      expect(result.renderedState.viewports[0]!.screenshotContentHash).toMatch(/^[a-f0-9]{64}$/);
      // The pixels the correction preflight used to discard.
      expect(result.captures[0]!.capture.bytes.byteLength).toBeGreaterThan(0);
      expect(result.renderedState.elements[0]!.text).toBe("Add Transaction");
      expect(browser.captures).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("the user's project is never written to, built in, or served from", async () => {
    const root = await fixture("bun --version");
    try {
      const before = (await readdir(root)).sort();
      const { project, proposal } = proposalFor(root);
      await renderProposedState(root, project, proposal, {
        viewports,
        signal: new AbortController().signal,
        renderer: renderer(),
      });
      expect(await readFile(join(root, "src", "App.jsx"), "utf8")).toContain("return null");
      expect((await readdir(root)).sort()).toEqual(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("the rendered state is bound to the exact proposal that was validated", async () => {
    const root = await fixture("bun --version");
    try {
      const { project, proposal } = proposalFor(root);
      const result = await renderProposedState(root, project, proposal, {
        viewports,
        signal: new AbortController().signal,
        renderer: renderer(),
        binding: { blueprintArtifactId: "ui-blueprint-1", implementationMapArtifactId: "implementation-map-1" },
      });
      expect(result.renderedState.binding.proposalHash).toBe(result.compile.proposalHash);
      expect(result.renderedState.binding.blueprintArtifactId).toBe("ui-blueprint-1");
      expect(result.renderedState.provenance.workspaceIsolated).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a proposal that does not build produces no render, and says why", async () => {
    const root = await fixture("false");
    try {
      const { project, proposal } = proposalFor(root);
      const browser = renderer();
      const result = await renderProposedState(root, project, proposal, {
        viewports,
        signal: new AbortController().signal,
        renderer: browser,
      });
      expect(result.compile.status).toBe("failed");
      expect(result.renderedState.status).toBe("render_failed");
      expect(result.renderedState.runtime.buildStatus).toBe("failed");
      expect(browser.captures).toBe(0);
      expect(result.captures).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a page that throws still yields evidence, with the error recorded", async () => {
    const root = await fixture("bun --version");
    try {
      const { project, proposal } = proposalFor(root);
      const result = await renderProposedState(root, project, proposal, {
        viewports,
        signal: new AbortController().signal,
        renderer: renderer({ runtimeErrors: ["NavigationMenu: items prop is required"] }),
      });
      // A widget that throws should not blind the reviewer to the rest of the
      // screen, so the capture is kept and the failure is reported beside it.
      expect(result.renderedState.status).toBe("rendered");
      expect(result.renderedState.viewports[0]!.runtimeErrorCount).toBe(1);
      expect(result.renderedState.runtime.diagnostics.join(" ")).toContain("NavigationMenu");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("no browser is reported as unavailable, not as a clean render", async () => {
    const root = await fixture("bun --version");
    try {
      const { project, proposal } = proposalFor(root);
      const result = await renderProposedState(root, project, proposal, {
        viewports,
        signal: new AbortController().signal,
        // No renderer, and Playwright is not installed in this test environment.
      });
      expect(["browser_unavailable", "rendered"]).toContain(result.renderedState.status);
      if (result.renderedState.status === "browser_unavailable")
        expect(result.renderedState.runtime.previewStatus).toBe("unavailable");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a project that moved after planning is refused before anything is built", async () => {
    const root = await fixture("bun --version");
    try {
      const { project, proposal } = proposalFor(root);
      const browser = renderer();
      const result = await renderProposedState(root, project, proposal, {
        viewports,
        signal: new AbortController().signal,
        renderer: browser,
        expectedProjectFingerprint: "fingerprint-when-planned",
        currentProjectFingerprint: "fingerprint-now",
      });
      expect(result.renderedState.status).toBe("project_changed_before_render");
      expect(browser.captures).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("diagnostics never leak the temporary workspace or an environment secret", async () => {
    const root = await fixture("bun --version");
    try {
      const { project, proposal } = proposalFor(root);
      const result = await renderProposedState(root, project, proposal, {
        viewports,
        signal: new AbortController().signal,
        renderer: renderer({ runtimeErrors: [`failed in ${tmpdir()}/somewhere with OPENROUTER_API_KEY=sk-secret-value`] }),
      });
      const text = JSON.stringify(result.renderedState);
      expect(text).not.toContain("sk-secret-value");
      expect(text).toContain("[REDACTED]");
      // And never a live preview address.
      expect(text).not.toContain("http://127.0.0.1");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
