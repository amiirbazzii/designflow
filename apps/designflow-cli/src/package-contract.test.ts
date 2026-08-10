// apps/designflow-cli/src/package-contract.test.ts
//
// The published package contract, pinned. designflow-ai is a CLI-only
// package (MVP-2B-2, Outcome A): it ships one binary and deliberately no
// library entry point — the old manifest pointed main/types/exports at a
// dist/index.js the build never produces. Every declared path must exist,
// and no field may quietly reintroduce a library claim.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PACKAGE_DIR = fileURLToPath(new URL("..", import.meta.url));

interface Manifest {
  name: string;
  version: string;
  type?: string;
  main?: string;
  types?: string;
  bin?: Record<string, string>;
  files?: string[];
  exports?: Record<string, unknown>;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  engines?: Record<string, string>;
}

function manifest(): Manifest {
  return JSON.parse(readFileSync(`${PACKAGE_DIR}package.json`, "utf8")) as Manifest;
}

describe("designflow-ai package contract (CLI-only)", () => {
  test("identity and version are unchanged", () => {
    const pkg = manifest();
    expect(pkg.name).toBe("designflow-ai");
    expect(pkg.version).toBe("0.2.0");
    expect(pkg.type).toBe("module");
    expect(pkg.engines?.["node"]).toBe(">=18");
  });

  test("no manifest field points at a file the build does not produce", () => {
    const pkg = manifest();
    expect(pkg.main).toBeUndefined();
    expect(pkg.types).toBeUndefined();
    for (const target of Object.values(pkg.bin ?? {})) {
      expect(existsSync(`${PACKAGE_DIR}${target}`)).toBe(true);
    }
    for (const target of Object.values(pkg.exports ?? {})) {
      expect(typeof target).toBe("string");
      expect(existsSync(`${PACKAGE_DIR}${target as string}`)).toBe(true);
    }
  });

  test("the binary is the whole public surface; no root library export exists", () => {
    const pkg = manifest();
    expect(pkg.bin).toEqual({ designflow: "dist/main.js" });
    expect(pkg.files).toEqual(["dist"]);
    // Only package.json is exported — a root import fails with Node's
    // standard ERR_PACKAGE_PATH_NOT_EXPORTED, never resolves CLI internals.
    expect(Object.keys(pkg.exports ?? {})).toEqual(["./package.json"]);
  });

  test("no runtime dependencies were introduced; Playwright stays optional", () => {
    const pkg = manifest();
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.optionalDependencies).toEqual({ playwright: "1.62.1" });
  });

  test("packing is protected by the canonical preparation hook", () => {
    const pkg = JSON.parse(readFileSync(`${PACKAGE_DIR}package.json`, "utf8")) as {
      scripts?: Record<string, string>;
    };
    // prepack runs for BOTH npm pack and npm publish, even from this
    // directory — the forced workspace rebuild cannot be bypassed by a
    // direct package-level pack. The old prepublishOnly (CLI-only build,
    // publish-only trigger) implied protection it did not provide.
    expect(pkg.scripts?.["prepack"]).toBe("bash ../../scripts/prepare-cli-package.sh");
    expect(pkg.scripts?.["prepublishOnly"]).toBeUndefined();
    expect(existsSync(`${PACKAGE_DIR}../../scripts/prepare-cli-package.sh`)).toBe(true);
  });

  test("the emitted binary keeps its shebang", () => {
    const first = readFileSync(`${PACKAGE_DIR}dist/main.js`, "utf8").slice(0, 32);
    expect(first.startsWith("#!/usr/bin/env node")).toBe(true);
  });
});
