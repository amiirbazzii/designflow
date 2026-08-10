import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

const AUTH_SESSION_VERSION = 1;
const DEFAULT_REFRESH_SKEW_MS = 60_000;

export const authSessionSchema = z.object({
  version: z.literal(AUTH_SESSION_VERSION),
  accessToken: z.string().min(1).max(16_384),
  refreshToken: z.string().min(1).max(16_384).optional(),
  expiresAt: z.number().int().positive(),
  user: z.object({
    id: z.string().min(1).max(512),
    email: z.string().min(1).max(1024).optional(),
  }).strict().optional(),
}).strict();

export type AuthSession = z.infer<typeof authSessionSchema>;

export interface SupabaseSessionLike {
  readonly access_token: string;
  readonly refresh_token?: string;
  /** Supabase's `expires_at` is expressed in epoch seconds. */
  readonly expires_at?: number;
  /** Some Auth responses provide `expires_in` instead of `expires_at`. */
  readonly expires_in?: number;
  readonly user?: { readonly id?: string; readonly email?: string };
}

export type AuthFailureCode =
  | "browser-unavailable"
  | "port-unavailable"
  | "cancelled"
  | "timeout"
  | "invalid-callback"
  | "auth-required"
  | "unavailable";

export type AuthSessionStatus =
  | "missing"
  | "connected"
  | "expired"
  | "corrupt"
  | "auth-required";

export interface AuthSessionSnapshot {
  readonly status: AuthSessionStatus;
  readonly session?: AuthSession;
}

export interface AuthClient {
  signInWithGoogle?(onBrowserFallback?: (url: string) => void): Promise<AuthSession>;
  refreshSession(refreshToken: string): Promise<AuthSession>;
  invalidateSession(accessToken: string): Promise<void>;
}

export interface AuthSessionServiceOptions {
  readonly sessionFile: string;
  readonly now?: () => number;
  readonly refreshSkewMs?: number;
  readonly client?: AuthClient;
}

/**
 * Small local session boundary. It owns parsing, persistence, expiry and
 * revocation state; callers never read the session file directly.
 */
export class AuthSessionService {
  private readonly sessionFile: string;
  private readonly now: () => number;
  private readonly refreshSkewMs: number;
  private readonly client: AuthClient | undefined;
  private refreshInFlight: Promise<AuthSessionStatus> | undefined;
  private authenticationRequired = false;

  public constructor(options: AuthSessionServiceOptions) {
    this.sessionFile = options.sessionFile;
    this.now = options.now ?? Date.now;
    this.refreshSkewMs = Math.max(0, options.refreshSkewMs ?? DEFAULT_REFRESH_SKEW_MS);
    this.client = options.client;
  }

  public snapshot(): AuthSessionSnapshot {
    if (this.authenticationRequired) return { status: "auth-required" };

    const loaded = this.readStoredSession();
    if (loaded === null) return { status: "missing" };
    if ("corrupt" in loaded) return { status: "corrupt" };

    return loaded.session.expiresAt > this.now()
      ? { status: "connected", session: loaded.session }
      : { status: "expired", session: loaded.session };
  }

  public currentBearerToken(): string | undefined {
    const snapshot = this.snapshot();
    return snapshot.status === "connected" ? snapshot.session?.accessToken : undefined;
  }

  public saveSession(session: AuthSession): void {
    const validated = authSessionSchema.parse({ ...session, version: AUTH_SESSION_VERSION });
    const directory = dirname(this.sessionFile);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    bestEffortChmod(directory, 0o700);

    const temporary = `${this.sessionFile}.${process.pid}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(validated, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      bestEffortChmod(temporary, 0o600);
      renameSync(temporary, this.sessionFile);
      bestEffortChmod(this.sessionFile, 0o600);
    } catch (error) {
      try { unlinkSync(temporary); } catch { /* preserve the original write error */ }
      throw error;
    }
    this.authenticationRequired = false;
  }

  public clearSession(): void {
    this.authenticationRequired = false;
    this.removeStoredSession();
  }

  public markAuthenticationRequired(): void {
    this.authenticationRequired = true;
    this.removeStoredSession();
  }

  public async signInWithGoogle(onBrowserFallback?: (url: string) => void): Promise<AuthSession> {
    if (this.client === undefined || this.client.signInWithGoogle === undefined) {
      throw new AuthSessionError("Sign-in is temporarily unavailable.", "unavailable");
    }
    try {
      const session = authSessionSchema.parse(await this.client.signInWithGoogle(onBrowserFallback));
      this.saveSession(session);
      return session;
    } catch (error) {
      if (error instanceof AuthSessionError) throw error;
      throw safeAuthError(error, "Sign-in is temporarily unavailable.");
    }
  }

  /** Attempts one bounded refresh. A failed refresh clears local auth state. */
  public async refreshIfNeeded(): Promise<AuthSessionStatus> {
    if (this.refreshInFlight !== undefined) return this.refreshInFlight;

    const snapshot = this.snapshot();
    const session = snapshot.session;
    if (
      session === undefined ||
      this.client === undefined ||
      session.refreshToken === undefined ||
      session.expiresAt > this.now() + this.refreshSkewMs
    ) {
      return snapshot.status;
    }

    this.refreshInFlight = (async () => {
      try {
        const client = this.client;
        if (client === undefined || session.refreshToken === undefined) {
          this.markAuthenticationRequired();
          return "auth-required" as const;
        }
        const refreshed = authSessionSchema.parse(await client.refreshSession(session.refreshToken));
        this.saveSession(refreshed);
        return "connected" as const;
      } catch {
        this.markAuthenticationRequired();
        return "auth-required" as const;
      }
    })().finally(() => {
      this.refreshInFlight = undefined;
    });

    return this.refreshInFlight;
  }

  /** Best-effort remote invalidation; local credentials are always removed. */
  public async signOut(): Promise<void> {
    const stored = this.readStoredSession();
    const session = stored !== null && !("corrupt" in stored) ? stored.session : undefined;
    try {
      if (session !== undefined && this.client !== undefined) {
        await this.client.invalidateSession(session.accessToken);
      }
    } catch {
      // Local clearing is the safety boundary. A remote failure must not leave
      // a bearer token on disk or expose a provider response to the terminal.
    } finally {
      this.clearSession();
    }
  }

  /** Converts the Supabase wire shape into the small persisted contract. */
  public static fromSupabaseSession(value: SupabaseSessionLike, now = Date.now()): AuthSession {
    const expiresAt = value.expires_at !== undefined
      ? value.expires_at * 1000
      : value.expires_in !== undefined
        ? now + value.expires_in * 1000
        : now;
    return authSessionSchema.parse({
      version: AUTH_SESSION_VERSION,
      accessToken: value.access_token,
      ...(value.refresh_token !== undefined ? { refreshToken: value.refresh_token } : {}),
      expiresAt,
      ...(value.user?.id !== undefined
        ? { user: { id: value.user.id, ...(value.user.email !== undefined ? { email: value.user.email } : {}) } }
        : {}),
    });
  }

  private readStoredSession(): { readonly session: AuthSession } | { readonly corrupt: true } | null {
    if (!existsSync(this.sessionFile)) return null;
    try {
      const parsed = authSessionSchema.safeParse(JSON.parse(readFileSync(this.sessionFile, "utf8")));
      return parsed.success ? { session: parsed.data } : { corrupt: true };
    } catch {
      return { corrupt: true };
    }
  }

  private removeStoredSession(): void {
    try { unlinkSync(this.sessionFile); } catch { /* already absent or inaccessible */ }
  }
}

export class AuthSessionError extends Error {
  public readonly code: AuthFailureCode | undefined;
  public readonly fallbackUrl: string | undefined;

  public constructor(message: string, code?: AuthFailureCode, fallbackUrl?: string) {
    super(message);
    this.name = "AuthSessionError";
    this.code = code;
    this.fallbackUrl = fallbackUrl;
  }
}

function safeAuthError(error: unknown, fallback: string): AuthSessionError {
  if (error instanceof AuthSessionError) return error;
  const code = (error as { code?: unknown }).code;
  if (
    code === "browser-unavailable" ||
    code === "port-unavailable" ||
    code === "cancelled" ||
    code === "timeout" ||
    code === "invalid-callback" ||
    code === "auth-required" ||
    code === "unavailable"
  ) {
    return new AuthSessionError(fallback, code);
  }
  return new AuthSessionError(fallback, "unavailable");
}

function bestEffortChmod(path: string, mode: number): void {
  try { chmodSync(path, mode); } catch { /* Windows and restricted filesystems may not support chmod. */ }
}
