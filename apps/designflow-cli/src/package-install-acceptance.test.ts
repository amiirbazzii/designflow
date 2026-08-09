// apps/designflow-cli/src/package-install-acceptance.test.ts
//
// Installed-package acceptance for the CLI-only contract (MVP-2B-2). Packs
// the real tarball, installs it into an isolated temp project with no
// workspace links, and proves: the manifest is internally consistent, the
// binary journey works against an isolated DESIGNFLOW_HOME, and a root
// library import fails with Node's standard not-exported error rather than
// resolving CLI internals.

import { describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_DIR = fileURLToPath(new URL("..", import.meta.url));

const describeOnPosix = process.platform === "win32" ? describe.skip : describe;

describeOnPosix("installed-package acceptance (CLI-only contract)", () => {
  test("pack, isolated install, CLI journey, and rejected library import", () => {
    const work = mkdtempSync(join(tmpdir(), "designflow-pack-"));
    try {
      // 1. Real tarball from the real package directory. --ignore-scripts
      // here ONLY because this test runs inside `turbo test`, where the
      // prepack hook's own forced `turbo build` would race the very task
      // graph executing this test; the dist under test was just built by
      // this task's own build dependency. The prepack freshness path is
      // exercised serially by scripts/verify-package-freshness.sh and the
      // CLI smoke test — --ignore-scripts is NOT a valid release path.
      const packOutput = execFileSync("npm", ["pack", "--ignore-scripts", "--pack-destination", work], {
        cwd: PACKAGE_DIR,
        encoding: "utf8",
      }).trim();
      const tarball = join(work, packOutput.split("\n").at(-1) ?? "");
      expect(tarball.endsWith("designflow-ai-0.1.2.tgz")).toBe(true);

      // 2. Isolated project install, no workspace resolution.
      const project = join(work, "consumer");
      execFileSync("mkdir", ["-p", project]);
      writeFileSync(join(project, "package.json"), JSON.stringify({ name: "consumer", private: true }));
      execFileSync("npm", ["install", "--omit=optional", "--no-audit", "--no-fund", tarball], {
        cwd: project,
        encoding: "utf8",
      });

      // 3. The installed manifest carries the corrected contract.
      const installed = JSON.parse(
        readFileSync(join(project, "node_modules", "designflow-ai", "package.json"), "utf8"),
      ) as { version: string; main?: string; types?: string; exports?: Record<string, string> };
      expect(installed.version).toBe("0.1.2");
      expect(installed.main).toBeUndefined();
      expect(installed.types).toBeUndefined();
      expect(installed.exports).toEqual({ "./package.json": "./package.json" });

      // 4–6. Binary journey with an isolated home and no repo dependence.
      const home = join(work, "home");
      const bin = join(project, "node_modules", ".bin", "designflow");
      for (const [args, expected] of [
        [["--help"], "your AI workforce"],
        [["--version"], "DesignFlow 0.1.2"],
        [["workers"], "Design Engineer"],
      ] as const) {
        const run = spawnSync(bin, [...args], {
          encoding: "utf8",
          env: { ...process.env, DESIGNFLOW_HOME: home },
        });
        expect(run.status).toBe(0);
        expect(run.stdout).toContain(expected);
      }

      // 7. A root library import fails with Node's own standard error —
      // clean, expected, and never resolving into CLI internals.
      const importProbe = spawnSync(
        "node",
        ["-e", "import('designflow-ai').then(() => process.exit(7), (e) => { console.log(e.code ?? e.name); process.exit(0); })"],
        { cwd: project, encoding: "utf8" },
      );
      expect(importProbe.status).toBe(0);
      expect(importProbe.stdout).toContain("ERR_PACKAGE_PATH_NOT_EXPORTED");
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120_000);
});
