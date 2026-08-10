import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AuthSessionService,
  type AuthClient,
  type AuthSession,
} from "./auth-session";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function sessionFile(): string {
  const home = mkdtempSync(join(tmpdir(), "designflow-auth-"));
  homes.push(home);
  return join(home, "auth", "session.json");
}

function session(expiresAt: number, refreshToken = "refresh-test-token"): AuthSession {
  return {
    version: 1,
    accessToken: "access-test-token",
    refreshToken,
    expiresAt,
    user: { id: "user-test", email: "user@example.test" },
  };
}

describe("AuthSessionService", () => {
  test("persists atomically with restrictive permissions and survives a new service instance", () => {
    const file = sessionFile();
    const first = new AuthSessionService({ sessionFile: file, now: () => 1_000 });
    first.saveSession(session(10_000));

    expect(first.snapshot().status).toBe("connected");
    expect(first.currentBearerToken()).toBe("access-test-token");
    expect(statSync(file).mode & 0o777).toBe(0o600);

    const restarted = new AuthSessionService({ sessionFile: file, now: () => 1_000 });
    expect(restarted.snapshot()).toMatchObject({ status: "connected", session: { user: { id: "user-test" } } });
  });

  test("rejects malformed state without throwing or returning a bearer", () => {
    const file = sessionFile();
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, JSON.stringify({ accessToken: "access-test-token", expiresAt: "never" }));

    const service = new AuthSessionService({ sessionFile: file, now: () => 1_000 });
    expect(service.snapshot().status).toBe("corrupt");
    expect(service.currentBearerToken()).toBeUndefined();
  });

  test("does not use expired access tokens and refreshes once through the injected seam", async () => {
    const file = sessionFile();
    let refreshCalls = 0;
    const client: AuthClient = {
      refreshSession: async (refreshToken) => {
        refreshCalls += 1;
        expect(refreshToken).toBe("refresh-test-token");
        return { ...session(20_000), accessToken: "refreshed-access-token" };
      },
      invalidateSession: async () => {},
    };
    const service = new AuthSessionService({ sessionFile: file, now: () => 10_000, client });
    service.saveSession(session(9_000));

    expect(service.currentBearerToken()).toBeUndefined();
    expect(service.snapshot().status).toBe("expired");
    expect(await service.refreshIfNeeded()).toBe("connected");
    expect(refreshCalls).toBe(1);
    expect(service.currentBearerToken()).toBe("refreshed-access-token");
  });

  test("failed refresh becomes auth-required and removes the expired local session", async () => {
    const file = sessionFile();
    const service = new AuthSessionService({
      sessionFile: file,
      now: () => 10_000,
      client: {
        refreshSession: async () => { throw new Error("provider details must not escape"); },
        invalidateSession: async () => {},
      },
    });
    service.saveSession(session(9_000));

    expect(await service.refreshIfNeeded()).toBe("auth-required");
    expect(service.snapshot().status).toBe("auth-required");
    expect(existsSync(file)).toBe(false);
  });

  test("401/revocation handling clears the session, and sign out is best effort", async () => {
    const file = sessionFile();
    let invalidated = "";
    const service = new AuthSessionService({
      sessionFile: file,
      now: () => 1_000,
      client: {
        refreshSession: async () => session(20_000),
        invalidateSession: async (token) => { invalidated = token; throw new Error("remote failure"); },
      },
    });
    service.saveSession(session(20_000));
    service.markAuthenticationRequired();
    expect(service.snapshot().status).toBe("auth-required");
    expect(existsSync(file)).toBe(false);

    service.saveSession(session(20_000));
    await service.signOut();
    expect(invalidated).toBe("access-test-token");
    expect(service.snapshot().status).toBe("missing");
  });

  test("normalizes the Supabase session shape without persisting extra account data", () => {
    const normalized = AuthSessionService.fromSupabaseSession({
      access_token: "access-test-token",
      refresh_token: "refresh-test-token",
      expires_at: 12,
      user: { id: "user-test", email: "user@example.test" },
    }, 1_000);
    expect(normalized).toEqual(session(12_000));
    expect(JSON.stringify(normalized)).not.toContain("provider");
  });

  test("persists the verified Google session returned through the auth seam", async () => {
    const file = sessionFile();
    const service = new AuthSessionService({
      sessionFile: file,
      now: () => 1_000,
      client: {
        signInWithGoogle: async () => session(20_000),
        refreshSession: async () => session(20_000),
        invalidateSession: async () => {},
      },
    });

    await service.signInWithGoogle();

    expect(service.snapshot().status).toBe("connected");
    expect(service.currentBearerToken()).toBe("access-test-token");
    expect(readFileSync(file, "utf8")).not.toContain("provider");
  });

  test("never exposes session values through a persisted file read failure", () => {
    const file = sessionFile();
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, "not-json");
    const service = new AuthSessionService({ sessionFile: file });
    expect(() => service.snapshot()).not.toThrow("not-json");
    expect(readFileSync(file, "utf8")).toBe("not-json");
  });
});
