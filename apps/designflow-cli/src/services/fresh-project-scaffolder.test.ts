import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { FreshFrameEvidence } from "./fresh-figma-evidence";
import {
  deriveFreshFrameSlug,
  FreshScaffoldError,
  resolveFreshScaffoldTarget,
  scaffoldFreshUiProject,
} from "./fresh-project-scaffolder";

function evidence(name = "Marketing / Home", id = "12:34"): FreshFrameEvidence {
  return {
    schemaVersion: "1",
    frame: { id, name, path: [name], width: 1440, height: 900 },
    snapshot: undefined as never,
    specificationEvidence: undefined,
  };
}

async function temporaryDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "designflow-fresh-scaffold-"));
}

describe("Fresh project scaffolder", () => {
  it("derives a stable portable slug from trusted frame evidence", () => {
    expect(deriveFreshFrameSlug(evidence("Marketing / Home"))).toBe("marketing-home");
    expect(deriveFreshFrameSlug(evidence("  Café — Overview  "))).toBe("caf-overview");
    expect(deriveFreshFrameSlug(evidence("!!!", "101:202"))).toBe("frame-101-202");
  });

  it("keeps a target strictly inside the approved root", () => {
    const resolved = resolveFreshScaffoldTarget("/tmp/designflow-output", "frame");
    expect(resolved.targetPath).toBe(resolve("/tmp/designflow-output/frame"));
    expect(() => resolveFreshScaffoldTarget("/tmp/designflow-output", "../escape")).toThrow(FreshScaffoldError);
    expect(() => resolveFreshScaffoldTarget("/tmp/designflow-output", "nested/frame")).toThrow(FreshScaffoldError);
    expect(() => resolveFreshScaffoldTarget("/tmp/designflow-output", "C:\\escape")).toThrow(FreshScaffoldError);
  });

  it("creates the fixed project tree and deterministic scripts", async () => {
    const root = await temporaryDirectory();
    try {
      const result = await scaffoldFreshUiProject({ evidence: evidence("Checkout"), outputRoot: root });
      expect(result.frameSlug).toBe("checkout");
      expect(result.files).toEqual([
        "package.json",
        "vite.config.ts",
        "tsconfig.json",
        "index.html",
        "src/main.tsx",
        "src/App.tsx",
        "src/styles.css",
        "src/assets/.gitkeep",
      ]);
      expect(await readdir(result.targetPath)).toEqual(expect.arrayContaining([
        "package.json",
        "vite.config.ts",
        "tsconfig.json",
        "index.html",
        "src",
      ]));
      const manifest = JSON.parse(await readFile(join(result.targetPath, "package.json"), "utf8")) as {
        scripts: Record<string, string>;
        dependencies: Record<string, string>;
      };
      expect(manifest.scripts).toEqual({ dev: "vite", build: "tsc --noEmit && vite build" });
      expect(manifest.dependencies).toEqual({ react: "18.3.1", "react-dom": "18.3.1" });
      expect(await readFile(join(result.targetPath, "src/App.tsx"), "utf8")).toContain("Fresh UI scaffold");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses an existing target without overwriting it", async () => {
    const root = await temporaryDirectory();
    try {
      const first = await scaffoldFreshUiProject({ evidence: evidence("Conflict"), outputRoot: root });
      const marker = join(first.targetPath, "marker.txt");
      await Bun.write(marker, "keep me");
      await expect(scaffoldFreshUiProject({ evidence: evidence("Conflict"), outputRoot: root })).rejects.toMatchObject({
        code: "ERR_FRESH_SCAFFOLD_CONFLICT",
      });
      expect(await readFile(marker, "utf8")).toBe("keep me");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked output-root ancestor", async () => {
    const parent = await temporaryDirectory();
    const realRoot = join(parent, "real-root");
    const linkedParent = join(parent, "linked-parent");
    try {
      await mkdir(realRoot);
      await Bun.write(join(realRoot, ".keep"), "");
      await symlink(realRoot, linkedParent);
      await expect(scaffoldFreshUiProject({
        evidence: evidence("Symlink boundary"),
        outputRoot: join(linkedParent, "output"),
      })).rejects.toMatchObject({ code: "ERR_FRESH_SCAFFOLD_PATH" });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("writes only below the requested output root and makes no AI/runtime calls", async () => {
    const parent = await temporaryDirectory();
    const root = join(parent, "output");
    try {
      const before = await readdir(parent);
      const result = await scaffoldFreshUiProject({ evidence: evidence("Boundary"), outputRoot: root });
      expect(result.targetPath.startsWith(`${await realpath(root)}/`)).toBe(true);
      expect(await readdir(parent)).toEqual(expect.arrayContaining([...before, "output"]));
      expect(await readdir(parent)).not.toContain("package.json");
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
