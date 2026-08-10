import { createServer } from "node:http";

export const GOOGLE_CALLBACK_HOST = "127.0.0.1";
export const GOOGLE_CALLBACK_PORT = 53_682;
export const GOOGLE_CALLBACK_PATH = "/auth/callback";
const DEFAULT_TIMEOUT_MS = 120_000;

export type OAuthCallbackFailureCode =
  | "cancelled"
  | "timeout"
  | "port-unavailable"
  | "state-mismatch"
  | "invalid-callback";

export interface OAuthCallbackResult {
  readonly code: string;
}

export interface OAuthCallbackServer {
  readonly redirectUri: string;
  readonly result: Promise<OAuthCallbackResult>;
  close(): Promise<void>;
}

export interface OAuthCallbackServerOptions {
  readonly state: string;
  readonly signal?: AbortSignal;
  /** Test-only timeout/port seams. Production uses the fixed callback port. */
  readonly timeoutMs?: number;
  readonly port?: number;
}

export class OAuthCallbackError extends Error {
  public readonly code: OAuthCallbackFailureCode;

  public constructor(code: OAuthCallbackFailureCode, message: string) {
    super(message);
    this.name = "OAuthCallbackError";
    this.code = code;
  }
}

/** A one-shot, loopback-only OAuth callback listener. */
export async function createOAuthCallbackServer(
  options: OAuthCallbackServerOptions,
): Promise<OAuthCallbackServer> {
  if (options.signal?.aborted === true) {
    throw new OAuthCallbackError("cancelled", "Google sign-in was cancelled.");
  }

  const port = options.port ?? GOOGLE_CALLBACK_PORT;
  let redirectUri = `http://${GOOGLE_CALLBACK_HOST}:${port}${GOOGLE_CALLBACK_PATH}`;
  const server = createServer();
  let settled = false;
  let listening = false;
  let closeInFlight: Promise<void> | undefined;
  let resolveResult!: (result: OAuthCallbackResult) => void;
  let rejectResult!: (error: OAuthCallbackError) => void;
  const result = new Promise<OAuthCallbackResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const close = (): Promise<void> => {
    if (!listening) return Promise.resolve();
    if (closeInFlight !== undefined) return closeInFlight;
    closeInFlight = new Promise((resolve) => {
      server.close(() => {
        listening = false;
        resolve();
      });
    });
    return closeInFlight;
  };

  const finish = (error?: OAuthCallbackError, value?: OAuthCallbackResult): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
    if (error !== undefined) rejectResult(error);
    else if (value !== undefined) resolveResult(value);
    void close();
  };

  const timeout = setTimeout(() => {
    finish(new OAuthCallbackError("timeout", "Google sign-in timed out. Try again."));
  }, Math.min(Math.max(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1), DEFAULT_TIMEOUT_MS));

  const abort = (): void => {
    finish(new OAuthCallbackError("cancelled", "Google sign-in was cancelled."));
  };

  server.on("request", (request, response) => {
    if (settled) {
      response.statusCode = 404;
      response.end();
      return;
    }

    const parsed = new URL(request.url ?? "", `http://${GOOGLE_CALLBACK_HOST}`);
    if (request.method !== "GET" || parsed.pathname !== GOOGLE_CALLBACK_PATH) {
      response.statusCode = 404;
      response.end();
      return;
    }

    const returnedState = parsed.searchParams.get("state");
    if (returnedState !== options.state) {
      respond(response, false);
      finish(new OAuthCallbackError("state-mismatch", "Google sign-in could not be verified."));
      return;
    }

    if (parsed.searchParams.has("error")) {
      respond(response, false);
      finish(new OAuthCallbackError("cancelled", "Google sign-in was cancelled."));
      return;
    }

    const code = parsed.searchParams.get("code");
    if (code === null || code.length === 0) {
      respond(response, false);
      finish(new OAuthCallbackError("invalid-callback", "Google sign-in could not be completed."));
      return;
    }

    respond(response, true);
    finish(undefined, { code });
  });

  const listeningPromise = new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      if (settled) return;
      const callbackError = new OAuthCallbackError(
        error.code === "EADDRINUSE" ? "port-unavailable" : "invalid-callback",
        error.code === "EADDRINUSE"
          ? "Could not start Google sign-in. The local sign-in port is already in use."
          : "Could not start Google sign-in.",
      );
      finish(callbackError);
      reject(callbackError);
    };
    server.once("error", onError);
    server.listen({ host: GOOGLE_CALLBACK_HOST, port }, () => {
      server.off("error", onError);
      listening = true;
      const address = server.address();
      if (typeof address === "object" && address !== null) {
        redirectUri = `http://${GOOGLE_CALLBACK_HOST}:${address.port}${GOOGLE_CALLBACK_PATH}`;
      }
      resolve();
    });
  });

  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    await listeningPromise;
  } catch (error) {
    await close();
    if (error instanceof OAuthCallbackError) throw error;
    throw error;
  }

  return { redirectUri, result, close };
}

function respond(response: import("node:http").ServerResponse, success: boolean): void {
  response.statusCode = success ? 200 : 400;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(success
    ? "<!doctype html><title>DesignFlow sign-in complete</title><p>DesignFlow sign-in complete. You can close this window and return to your terminal.</p>"
    : "<!doctype html><title>DesignFlow sign-in</title><p>DesignFlow could not complete sign-in. You can close this window and return to your terminal.</p>");
}
