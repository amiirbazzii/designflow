import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectRegisteredProject, projectFileHash } from "@designflow/capability-implementation";
import { proposedFileChangesSchema } from "@designflow/sdk";
import { preflightCorrectionProposal } from "../../visual-correction/correction-runtime-preflight";

async function fixture(build: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "designflow-correction-preflight-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "correction-preflight-fixture",
      scripts: { build, preview: "node preview.mjs" },
    }),
  );
  await writeFile(
    join(root, "preview.mjs"),
    "import http from 'node:http'; const port = Number(process.argv.at(-1)); http.createServer((_, response) => { response.writeHead(200, {'content-type':'text/html'}); response.end('<!doctype html><html><body>fixture</body></html>'); }).listen(port, '127.0.0.1');\n",
  );
  await writeFile(join(root, "src", "App.jsx"), "export default function App() { return null; }\n");
  return root;
}

function proposal(root: string) {
  const project = inspectRegisteredProject({ id: "preflight-project", name: "Fixture", rootPath: root });
  return {
    project,
    proposal: proposedFileChangesSchema.parse({
      schemaVersion: "1",
      projectId: project.project.id,
      baseProjectFingerprint: project.project.contextFingerprint,
      files: [{
        path: "src/App.jsx",
        action: "modify",
        content: "export default function App() { return 'correction'; }\n",
        expectedBaseHash: projectFileHash(join(root, "src", "App.jsx")),
        reason: "Test correction proposal.",
        relatedDesignNodeIds: ["frame-1"],
      }],
      packageChanges: [],
      commandsRequested: [],
      assumptions: [],
      unresolvedItems: [],
    }),
  };
}

function renderer(runtimeErrors: readonly string[] = []) {
  let captures = 0;
  return {
    get captures() { return captures; },
    async capture(_url: string, viewport: { width: number; height: number }) {
      captures += 1;
      return {
        bytes: new Uint8Array([137, 80, 78, 71]),
        width: viewport.width,
        height: viewport.height,
        consoleErrors: [],
        runtimeErrors,
        failedResources: [],
        warnings: [],
      };
    },
    async close() {},
  };
}

const viewports = [{ id: "desktop", width: 320, height: 240 }];

describe("correction proposed-state runtime preflight", () => {
  test("compile-valid NavigationMenu-style runtime failure blocks approval preflight", async () => {
    const root = await fixture("bun --version");
    try {
      const { project, proposal: exact } = proposal(root);
      const browser = renderer(["NavigationMenu: items prop is required"]);
      const result = await preflightCorrectionProposal(
        root,
        project,
        exact,
        viewports,
        new AbortController().signal,
        browser,
      );
      expect(result.compile.status).toBe("passed");
      expect(result.runtime.status).toBe("failed");
      expect(result.runtime.diagnostics[0]?.message).toContain("NavigationMenu");
      expect(browser.captures).toBe(1);
      expect(await readFile(join(root, "src", "App.jsx"), "utf8")).toContain("return null");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("repaired runtime contract passes and binds the exact proposal hash", async () => {
    const root = await fixture("bun --version");
    try {
      const { project, proposal: exact } = proposal(root);
      const browser = renderer();
      const result = await preflightCorrectionProposal(
        root,
        project,
        exact,
        viewports,
        new AbortController().signal,
        browser,
      );
      expect(result.compile.status).toBe("passed");
      expect(result.runtime.status).toBe("passed");
      expect(result.proposalHash).toMatch(/^[a-f0-9]{64}$/);
      expect(browser.captures).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("compile failure short-circuits runtime preview", async () => {
    const root = await fixture("false");
    try {
      const { project, proposal: exact } = proposal(root);
      const browser = renderer();
      const result = await preflightCorrectionProposal(
        root,
        project,
        exact,
        viewports,
        new AbortController().signal,
        browser,
      );
      expect(result.compile.status).toBe("failed");
      expect(result.runtime.status).toBe("failed");
      expect(browser.captures).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
