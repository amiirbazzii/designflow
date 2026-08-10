import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import {
  AuthSessionError,
  AuthSessionService,
  type AuthClient,
  type AuthSession,
  type SupabaseSessionLike,
} from "./auth-session";
import {
  createOAuthCallbackServer,
  GOOGLE_CALLBACK_HOST,
  GOOGLE_CALLBACK_PATH,
  GOOGLE_CALLBACK_PORT,
  type OAuthCallbackServer,
} from "./oauth-callback";

const MAX_AUTH_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_AUTH_TIMEOUT_MS = 10_000;

export interface OAuthCallbackServerFactory {
  (options: {
    readonly state: string;
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
  }): Promise<OAuthCallbackServer>;
}

export interface SupabaseAuthClientOptions {
  readonly url: string;
  readonly publishableKey: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly now?: () => number;
  readonly openBrowser?: (url: string) => Promise<boolean>;
  readonly callbackServerFactory?: OAuthCallbackServerFactory;
  readonly oauthTimeoutMs?: number;
  readonly signal?: AbortSignal;
}

/** Minimal direct Supabase Auth adapter for the CLI's Google PKCE path. */
export class SupabaseAuthClient implements AuthClient {
  private readonly authUrl: string;
  private readonly supabaseUrl: string;
  private readonly publishableKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly openBrowser: (url: string) => Promise<boolean>;
  private readonly callbackServerFactory: OAuthCallbackServerFactory;
  private readonly oauthTimeoutMs: number;
  private readonly signal: AbortSignal | undefined;

  public constructor(options: SupabaseAuthClientOptions) {
    this.supabaseUrl = options.url.replace(/\/$/, "");
    this.authUrl = `${this.supabaseUrl}/auth/v1`;
    this.publishableKey = options.publishableKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = Math.min(Math.max(options.timeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS, 1), DEFAULT_AUTH_TIMEOUT_MS);
    this.now = options.now ?? Date.now;
    this.openBrowser = options.openBrowser ?? openBrowserUrl;
    this.callbackServerFactory = options.callbackServerFactory ?? ((callbackOptions) =>
      createOAuthCallbackServer({
        ...callbackOptions,
        port: GOOGLE_CALLBACK_PORT,
      }));
    this.oauthTimeoutMs = options.oauthTimeoutMs ?? 120_000;
    this.signal = options.signal;
  }

  public async signInWithGoogle(onBrowserFallback?: (url: string) => void): Promise<AuthSession> {
    const verifier = randomBytes(32).toString("base64url");
    const state = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    let callback: OAuthCallbackServer | undefined;
    try {
      callback = await this.callbackServerFactory({
        state,
        ...(this.signal !== undefined ? { signal: this.signal } : {}),
        timeoutMs: this.oauthTimeoutMs,
      });
      const authorizationUrl = new URL(`${this.authUrl}/authorize`);
      authorizationUrl.searchParams.set("provider", "google");
      authorizationUrl.searchParams.set("redirect_to", callback.redirectUri);
      authorizationUrl.searchParams.set("code_challenge", challenge);
      authorizationUrl.searchParams.set("code_challenge_method", "S256");
      authorizationUrl.searchParams.set("state", state);

      const opened = await this.openBrowser(authorizationUrl.toString());
      if (!opened) {
        onBrowserFallback?.(authorizationUrl.toString());
      }
      const callbackResult = await callback.result;
      const response = await this.request(
        "/token?grant_type=pkce",
        { auth_code: callbackResult.code, code_verifier: verifier },
        "oauth",
      );
      return normalizeSession(response, this.now);
    } catch (error) {
      if (error instanceof AuthSessionError) throw error;
      const code = (error as { code?: unknown }).code;
      if (code === "cancelled" || code === "timeout" || code === "port-unavailable" || code === "state-mismatch" || code === "invalid-callback") {
        throw new AuthSessionError(String((error as { message?: unknown }).message ?? "Sign-in could not be completed."), code);
      }
      throw new AuthSessionError("Sign-in is temporarily unavailable.", "unavailable");
    } finally {
      await callback?.close();
    }
  }

  public async refreshSession(refreshToken: string): Promise<AuthSession> {
    const response = await this.request(
      "/token?grant_type=refresh_token",
      { refresh_token: refreshToken },
      "refresh",
    );
    return normalizeSession(response, this.now);
  }

  public async invalidateSession(accessToken: string): Promise<void> {
    await this.request("/logout", undefined, "logout", accessToken);
  }

  private async request(
    path: string,
    body: Record<string, unknown> | undefined,
    operation: "oauth" | "refresh" | "logout",
    accessToken?: string,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const forwardAbort = (): void => controller.abort();
    this.signal?.addEventListener("abort", forwardAbort, { once: true });
    try {
      const response = await this.fetchImpl(`${this.authUrl}${path}`, {
        method: "POST",
        headers: {
          apikey: this.publishableKey,
          "Content-Type": "application/json",
          ...(accessToken !== undefined ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });

      if (!response.ok) throw classifyAuthResponse(response.status, operation);
      return boundedJson(response);
    } catch (error) {
      if (error instanceof AuthSessionError) throw error;
      throw new AuthSessionError("Sign-in is temporarily unavailable.", "unavailable");
    } finally {
      clearTimeout(timeout);
      this.signal?.removeEventListener("abort", forwardAbort);
    }
  }
}

async function boundedJson(response: Response): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > MAX_AUTH_RESPONSE_BYTES) {
    throw new AuthSessionError("Sign-in is temporarily unavailable.", "unavailable");
  }
  const text = await response.text();
  if (text.length > MAX_AUTH_RESPONSE_BYTES) {
    throw new AuthSessionError("Sign-in is temporarily unavailable.", "unavailable");
  }
  if (text.length === 0) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AuthSessionError("Sign-in is temporarily unavailable.", "unavailable");
  }
}

function classifyAuthResponse(status: number, operation: "oauth" | "refresh" | "logout"): AuthSessionError {
  if (operation === "refresh" && (status === 400 || status === 401 || status === 403)) {
    return new AuthSessionError("AI connection needs sign-in.", "auth-required");
  }
  if (operation === "oauth" && (status === 400 || status === 401 || status === 422)) {
    return new AuthSessionError("Sign-in is temporarily unavailable.", "unavailable");
  }
  if (operation === "logout" && (status === 401 || status === 404)) {
    return new AuthSessionError("AI connection needs sign-in.", "auth-required");
  }
  return new AuthSessionError("Sign-in is temporarily unavailable.", "unavailable");
}

function normalizeSession(value: unknown, now: () => number): AuthSession {
  if (typeof value !== "object" || value === null) {
    throw new AuthSessionError("Sign-in is temporarily unavailable.", "unavailable");
  }
  const session = value as Partial<SupabaseSessionLike>;
  try {
    return AuthSessionService.fromSupabaseSession({
      access_token: session.access_token ?? "",
      ...(session.refresh_token !== undefined ? { refresh_token: session.refresh_token } : {}),
      ...(session.expires_at !== undefined ? { expires_at: session.expires_at } : {}),
      ...(session.expires_in !== undefined ? { expires_in: session.expires_in } : {}),
      ...(session.user !== undefined ? { user: session.user } : {}),
    }, now());
  } catch {
    throw new AuthSessionError("Sign-in is temporarily unavailable.", "unavailable");
  }
}

export function openBrowserUrl(url: string): Promise<boolean> {
  const platform = process.platform;
  const command = platform === "darwin"
    ? "open"
    : platform === "win32"
      ? "rundll32.exe"
      : "xdg-open";
  const args = platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore", shell: false });
    child.unref();
    return Promise.resolve(true);
  } catch {
    return Promise.resolve(false);
  }
}

export {
  GOOGLE_CALLBACK_HOST,
  GOOGLE_CALLBACK_PATH,
  GOOGLE_CALLBACK_PORT,
};
