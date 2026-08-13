// workflows/workflow-design-to-code/src/v2-visual/test/support/spendly-v2-fixture.ts
//
// A Spendly-shaped V2 input: the design, the plan, and a deliberately
// imperfect implementation of it.
//
// The imperfections are the point. Each one is a real class of failure the
// field produced — a header that is the wrong height, a field whose surface is
// wrong, a primary button with the wrong geometry, and a bottom navigation
// that is simply missing — and the stage must catch all four before anyone
// approves anything.
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { compileUIBlueprintDraft } from "@designflow/agents";
import { inspectRegisteredProject, projectFileHash } from "@designflow/capability-implementation";
import {
  figmaSourceSnapshotSchema,
  implementationMapSchema,
  proposedFileChangesSchema,
  type ImplementationMap,
  type ProposedFileChanges,
  type UIBlueprint,
} from "@designflow/sdk";

export const DESIGN_IDENTITY = { fileKey: "spendly-file", nodeId: "1:1" } as const;

const SNAPSHOT = figmaSourceSnapshotSchema.parse({
  schemaVersion: "1",
  source: {
    fileKey: DESIGN_IDENTITY.fileKey,
    designFile: "Spendly",
    documentVersion: "1",
    frames: ["Add Transaction"],
    resolvedFrames: [{ id: "1:1", name: "Add Transaction" }],
  },
  components: [],
  variables: [],
  assets: [],
  nodes: [
    { id: "1:1", name: "Add Transaction", type: "FRAME", childIds: ["1:2", "1:3", "1:4", "1:5"], absoluteBoundingBox: { x: 0, y: 0, width: 390, height: 844 } },
    {
      id: "1:2",
      name: "Header",
      type: "TEXT",
      parentId: "1:1",
      characters: "Add Transaction",
      absoluteBoundingBox: { x: 0, y: 0, width: 390, height: 72 },
      properties: { typography: { fontFamily: "Inter", fontSize: 24 } },
    },
    {
      id: "1:3",
      name: "Amount field",
      type: "TEXT",
      parentId: "1:1",
      characters: "Enter amount",
      absoluteBoundingBox: { x: 16, y: 96, width: 358, height: 56 },
      properties: { typography: { fontFamily: "Inter", fontSize: 16 } },
    },
    {
      id: "1:4",
      name: "Primary button",
      type: "TEXT",
      parentId: "1:1",
      characters: "Fill the information",
      absoluteBoundingBox: { x: 16, y: 700, width: 358, height: 56 },
      properties: { typography: { fontFamily: "Inter", fontSize: 16 } },
    },
    {
      id: "1:5",
      name: "BottomNavigation",
      type: "FRAME",
      parentId: "1:1",
      childIds: [],
      absoluteBoundingBox: { x: 0, y: 776, width: 390, height: 68 },
    },
  ],
});

export const BLUEPRINT: UIBlueprint = compileUIBlueprintDraft(SNAPSHOT, { snapshotArtifactId: "figma-source-snapshot" });

export const NAV_REQUIREMENT = "requirement:component:BottomNavigation";
export const SCREEN_REQUIREMENT = "requirement:screen";

/**
 * The plan. Hand-written rather than compiled, so the fixture states exactly
 * which decisions the render is being held to.
 */
export const MAP: ImplementationMap = implementationMapSchema.parse({
  schemaVersion: "1",
  status: "complete",
  binding: {
    blueprintArtifactId: "ui-blueprint",
    blueprintCompilerVersion: "0.1.0",
    blueprintScreenNodeId: "1:1",
    blueprintSemanticStatus: "not_requested",
    projectContextArtifactId: "project-context",
    projectContextCompilerVersion: "0.1.0",
    projectRootIdentity: "v2-visual-fixture",
  },
  requirements: [
    { id: SCREEN_REQUIREMENT, kind: "screen-reachability", label: "Add Transaction", blueprintRef: "1:1", required: true },
    { id: NAV_REQUIREMENT, kind: "component-definition", label: "BottomNavigation", blueprintRef: "1:5", required: true },
  ],
  candidates: [],
  destinationCandidates: [],
  plannedDirectories: [],
  projectTokens: [],
  projectAssets: [],
  bounds: [],
  provenance: { compilerVersion: "0.1.0" },
  screen: {
    requirementId: SCREEN_REQUIREMENT,
    destination: { action: "create_page", candidateId: "destination-1", path: "src/App.jsx" },
    reason: "the fixture project renders a single screen",
    confidence: "high",
  },
  components: [
    {
      requirementId: NAV_REQUIREMENT,
      blueprintComponentId: "1:5",
      action: "create",
      plannedPath: "src/BottomNavigation.jsx",
      requiredAdaptations: [],
      reason: "no project equivalent exists",
      confidence: "high",
      compatibility: {
        structure: "compatible",
        slots: "compatible",
        states: "compatible",
        visual: "compatible",
        interaction: "compatible",
      },
    },
  ],
  styles: [],
  assets: [],
  coverage: {
    totalRequired: 2,
    retained: 2,
    truncated: false,
    entries: [
      { requirementId: SCREEN_REQUIREMENT, kind: "screen-reachability", label: "Add Transaction", status: "mapped" },
      { requirementId: NAV_REQUIREMENT, kind: "component-definition", label: "BottomNavigation", status: "mapped" },
    ],
    status: "complete",
  },
  uncertainties: [],
  mapper: { partitionCount: 1, patchCount: 1 },
});

/**
 * A deliberately imperfect implementation.
 *
 *   header             renders at 40px where the design says 72px
 *   amount field       renders at 32px where the design says 56px
 *   primary button     renders at 30px where the design says 56px
 *   bottom navigation  is not rendered at all
 */
export const IMPERFECT_PAGE = `export default function App() {
  return (
    <main>
      <h1 style={{ height: 40 }}>Add Transaction</h1>
      <div style={{ height: 32 }}>Enter amount</div>
      <button style={{ height: 30 }}>Fill the information</button>
    </main>
  );
}
`;

/** The same screen, built the way the design describes it. */
export const FAITHFUL_PAGE = `import BottomNavigation from "./BottomNavigation";

export default function App() {
  return (
    <main>
      <h1 style={{ height: 72 }}>Add Transaction</h1>
      <div style={{ height: 56 }}>Enter amount</div>
      <button style={{ height: 56 }}>Fill the information</button>
      <BottomNavigation />
    </main>
  );
}
`;

export const NAV_COMPONENT = `export default function BottomNavigation() {
  return <nav style={{ height: 68 }} />;
}
`;

export async function fixtureProject(build = "bun --version"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "designflow-v2-visual-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "v2-visual-fixture", scripts: { build, preview: "node preview.mjs" } }),
  );
  await writeFile(
    join(root, "preview.mjs"),
    "import http from 'node:http'; const port = Number(process.argv.at(-1)); http.createServer((_, response) => { response.writeHead(200, {'content-type':'text/html'}); response.end('<!doctype html><html><body>fixture</body></html>'); }).listen(port, '127.0.0.1');\n",
  );
  await writeFile(join(root, "src", "App.jsx"), "export default function App() { return null; }\n");
  return root;
}

export function proposalFor(
  root: string,
  files: readonly { path: string; content: string; action?: "create" | "modify" }[],
): { project: ReturnType<typeof inspectRegisteredProject>; proposal: ProposedFileChanges } {
  const project = inspectRegisteredProject({ id: "v2-visual-project", name: "Fixture", rootPath: root });
  return {
    project,
    proposal: proposedFileChangesSchema.parse({
      schemaVersion: "1",
      projectId: project.project.id,
      baseProjectFingerprint: project.project.contextFingerprint,
      files: files.map((file) => ({
        path: file.path,
        action: file.action ?? (file.path.endsWith("App.jsx") ? "modify" : "create"),
        content: file.content,
        ...(file.path.endsWith("App.jsx") ? { expectedBaseHash: projectFileHash(join(root, "src", "App.jsx")) } : {}),
        reason: "fixture proposal",
        relatedDesignNodeIds: ["1:1"],
      })),
      packageChanges: [],
      commandsRequested: [],
      assumptions: [],
      unresolvedItems: [],
    }),
  };
}

// ── Rendered DOM, as a browser would report it ──────────────────

export interface FakeElement {
  readonly selector: string;
  readonly tagName: string;
  readonly text?: string;
  readonly height: number;
  readonly width?: number;
  readonly instrumentationRef?: string;
}

/** What the imperfect page renders: wrong sizes, and no navigation at all. */
export const IMPERFECT_DOM: readonly FakeElement[] = [
  { selector: "h1", tagName: "h1", text: "Add Transaction", height: 40, instrumentationRef: SCREEN_REQUIREMENT },
  { selector: "div", tagName: "div", text: "Enter amount", height: 32 },
  { selector: "button", tagName: "button", text: "Fill the information", height: 30 },
];

/** What the faithful page renders. */
export const FAITHFUL_DOM: readonly FakeElement[] = [
  { selector: "h1", tagName: "h1", text: "Add Transaction", height: 72, instrumentationRef: SCREEN_REQUIREMENT },
  { selector: "div", tagName: "div", text: "Enter amount", height: 56 },
  { selector: "button", tagName: "button", text: "Fill the information", height: 56 },
  { selector: "nav", tagName: "nav", height: 68, width: 390, instrumentationRef: NAV_REQUIREMENT },
];

export function fakeRenderer(elements: readonly FakeElement[], bytes?: Uint8Array) {
  return {
    async capture(_url: string, viewport: { width: number; height: number }) {
      return {
        bytes: bytes ?? png(viewport.width, viewport.height, () => [255, 255, 255, 255]),
        width: viewport.width,
        height: viewport.height,
        consoleErrors: [],
        runtimeErrors: [],
        failedResources: [],
        warnings: [],
        dom: {
          elements: elements.map((element, index) => ({
            selector: element.selector,
            tagName: element.tagName,
            ancestorPath: ["body", "main"],
            siblingIndex: index,
            ...(element.instrumentationRef !== undefined ? { instrumentationRef: element.instrumentationRef } : {}),
            ...(element.text !== undefined ? { text: element.text } : {}),
            x: 0,
            y: index * 100,
            width: element.width ?? 358,
            height: element.height,
          })),
          overflow: [],
        },
      };
    },
    async close() {},
  };
}

export function png(
  width: number,
  height: number,
  color: (x: number, y: number) => [number, number, number, number],
): Uint8Array {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x += 1) raw.set(color(x, y), y * (width * 4 + 1) + 1 + x * 4);
  }
  const chunk = (type: string, data: Uint8Array): Buffer => {
    const result = Buffer.alloc(12 + data.byteLength);
    result.writeUInt32BE(data.byteLength, 0);
    result.write(type, 4, 4, "ascii");
    Buffer.from(data).copy(result, 8);
    return result;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", new Uint8Array(deflateSync(new Uint8Array(raw)))),
      chunk("IEND", new Uint8Array()),
    ]),
  );
}
