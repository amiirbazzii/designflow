import { afterEach, describe, expect, test } from "bun:test";
import {
  createOAuthCallbackServer,
  GOOGLE_CALLBACK_HOST,
  GOOGLE_CALLBACK_PATH,
} from "./oauth-callback";

const servers: Array<{ close(): Promise<void> }> = [];

async function expectCallbackFailure(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await promise;
    throw new Error(`expected callback failure: ${code}`);
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

describe("loopback OAuth callback", () => {
  test("binds to loopback, accepts one matching callback, and closes", async () => {
    const server = await createOAuthCallbackServer({ state: "state-1", port: 0 });
    servers.push(server);

    expect(server.redirectUri).toContain(`http://${GOOGLE_CALLBACK_HOST}:`);
    expect(server.redirectUri).toContain(GOOGLE_CALLBACK_PATH);
    const response = await fetch(`${server.redirectUri}?state=state-1&code=code-1`);
    await response.text();
    expect(response.status).toBe(200);
    expect(await server.result).toEqual({ code: "code-1" });
  });

  test("rejects mismatched state and missing authorization code", async () => {
    const mismatch = await createOAuthCallbackServer({ state: "state-2", port: 0 });
    servers.push(mismatch);
    const mismatchResult = expectCallbackFailure(mismatch.result, "state-mismatch");
    const mismatchResponse = await fetch(`${mismatch.redirectUri}?state=wrong&code=code`);
    await mismatchResponse.text();
    expect(mismatchResponse.status).toBe(400);
    await mismatchResult;

    const missing = await createOAuthCallbackServer({ state: "state-3", port: 0 });
    servers.push(missing);
    const missingResult = expectCallbackFailure(missing.result, "invalid-callback");
    const missingResponse = await fetch(`${missing.redirectUri}?state=state-3`);
    await missingResponse.text();
    expect(missingResponse.status).toBe(400);
    await missingResult;
  });

  test("handles denial, timeout, and cancellation without leaving a listener", async () => {
    const denied = await createOAuthCallbackServer({ state: "state-4", port: 0 });
    servers.push(denied);
    const deniedResult = expectCallbackFailure(denied.result, "cancelled");
    const deniedResponse = await fetch(`${denied.redirectUri}?state=state-4&error=access_denied`);
    await deniedResponse.text();
    expect(deniedResponse.status).toBe(400);
    await deniedResult;

    const timedOut = await createOAuthCallbackServer({ state: "state-5", port: 0, timeoutMs: 5 });
    servers.push(timedOut);
    await expectCallbackFailure(timedOut.result, "timeout");

    const controller = new AbortController();
    const cancelled = await createOAuthCallbackServer({ state: "state-6", port: 0, signal: controller.signal });
    servers.push(cancelled);
    const cancelledResult = expectCallbackFailure(cancelled.result, "cancelled");
    controller.abort();
    await cancelledResult;
  });
});
