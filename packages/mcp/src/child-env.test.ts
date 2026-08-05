// packages/mcp/src/child-env.test.ts
import { describe, expect, test } from "bun:test";
import {
  buildMcpChildEnv,
  MCP_CHILD_ENV_BASELINE_COMMON,
  MCP_CHILD_ENV_BASELINE_POSIX,
  MCP_CHILD_ENV_BASELINE_WINDOWS,
} from "./child-env";

describe("safe baseline", () => {
  test("PATH is inherited when present", () => {
    const env = buildMcpChildEnv({ platform: "darwin", parentEnv: { PATH: "/usr/bin:/bin" } });
    expect(env["PATH"]).toBe("/usr/bin:/bin");
  });

  test("locale and temp variables in the policy are inherited", () => {
    const env = buildMcpChildEnv({
      platform: "linux",
      parentEnv: { TMPDIR: "/tmp", LANG: "en_US.UTF-8", LC_ALL: "C", LC_CTYPE: "UTF-8", TMP: "/t", TEMP: "/te" },
    });
    expect(env).toEqual({ TMPDIR: "/tmp", LANG: "en_US.UTF-8", LC_ALL: "C", LC_CTYPE: "UTF-8", TMP: "/t", TEMP: "/te" });
  });

  test("HOME is inherited on POSIX but is not part of the Windows baseline", () => {
    const parentEnv = { HOME: "/Users/dev" };
    expect(buildMcpChildEnv({ platform: "darwin", parentEnv })["HOME"]).toBe("/Users/dev");
    expect(buildMcpChildEnv({ platform: "win32", parentEnv })["HOME"]).toBeUndefined();
  });

  test("Windows startup variables are inherited only on win32", () => {
    const parentEnv = {
      SystemRoot: "C:\\Windows",
      COMSPEC: "C:\\Windows\\System32\\cmd.exe",
      PATHEXT: ".COM;.EXE;.BAT",
      USERPROFILE: "C:\\Users\\dev",
      HOMEDRIVE: "C:",
      HOMEPATH: "\\Users\\dev",
    };
    const windows = buildMcpChildEnv({ platform: "win32", parentEnv });
    expect(windows).toEqual(parentEnv);

    const posix = buildMcpChildEnv({ platform: "linux", parentEnv });
    expect(posix).toEqual({});
  });

  test("Windows lookups are case-insensitive; POSIX lookups are exact", () => {
    const parentEnv = { Path: "C:\\Windows;C:\\bin" };
    expect(buildMcpChildEnv({ platform: "win32", parentEnv })["PATH"]).toBe("C:\\Windows;C:\\bin");
    expect(buildMcpChildEnv({ platform: "linux", parentEnv })["PATH"]).toBeUndefined();
  });

  test("absent baseline variables are omitted, never serialized as invalid values", () => {
    const env = buildMcpChildEnv({ platform: "darwin", parentEnv: {} });
    expect(env).toEqual({});
    expect(Object.keys(env)).toEqual([]);
  });

  test("the baseline lists contain no credential-bearing or injection names", () => {
    const all = [
      ...MCP_CHILD_ENV_BASELINE_COMMON,
      ...MCP_CHILD_ENV_BASELINE_POSIX,
      ...MCP_CHILD_ENV_BASELINE_WINDOWS,
    ];
    for (const forbidden of ["NODE_OPTIONS", "BUN_OPTIONS", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES", "NPM_TOKEN", "OPENROUTER_API_KEY", "HTTP_PROXY", "HTTPS_PROXY"]) {
      expect(all).not.toContain(forbidden);
    }
  });
});

describe("secret exclusion", () => {
  test("parent secrets never reach the child environment unless authorized", () => {
    const env = buildMcpChildEnv({
      platform: "darwin",
      parentEnv: {
        PATH: "/usr/bin",
        OPENROUTER_API_KEY: "sk-or-fake",
        AWS_SECRET_ACCESS_KEY: "aws-fake",
        GITHUB_TOKEN: "ghp-fake",
        CI_JOB_TOKEN: "ci-fake",
        MY_CUSTOM_SECRET: "custom-fake",
        NODE_OPTIONS: "--require evil",
      },
    });
    expect(env).toEqual({ PATH: "/usr/bin" });
  });
});

describe("explicit passthrough", () => {
  test("an authorized variable is present with its exact value; unrelated ones stay absent", () => {
    const env = buildMcpChildEnv({
      platform: "darwin",
      parentEnv: { PATH: "/usr/bin", UNRELATED_SECRET: "nope" },
      authorized: { FIGMA_ACCESS_TOKEN: "figd-fake-token" },
    });
    expect(env["FIGMA_ACCESS_TOKEN"]).toBe("figd-fake-token");
    expect(env["UNRELATED_SECRET"]).toBeUndefined();
    expect(env["PATH"]).toBe("/usr/bin");
  });

  test("a deliberately authorized name overrides the baseline value", () => {
    const env = buildMcpChildEnv({
      platform: "darwin",
      parentEnv: { PATH: "/usr/bin" },
      authorized: { PATH: "/custom/bin" },
    });
    expect(env["PATH"]).toBe("/custom/bin");
  });

  test("special object keys never become environment entries", () => {
    const env = buildMcpChildEnv({
      platform: "darwin",
      parentEnv: {},
      authorized: JSON.parse('{"__proto__": "polluted", "constructor": "x", "prototype": "y", "SAFE": "ok"}') as Record<string, string>,
    });
    expect(env).toEqual({ SAFE: "ok" });
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  test("the result is a plain object compatible with spawn", () => {
    const env = buildMcpChildEnv({ platform: "darwin", parentEnv: { PATH: "/usr/bin" } });
    expect(Object.getPrototypeOf(env)).toBe(Object.prototype);
  });
});
