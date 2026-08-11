import type { AiConnectionStatus } from "../../services/cli-runner";

export type TuiAuthStatus = AiConnectionStatus;

export interface TuiAuthController {
  readonly status: () => TuiAuthStatus;
  readonly signInWithGoogle: (onBrowserFallback?: (url: string) => void) => Promise<TuiAuthStatus>;
}

export function requiresInteractiveAuthentication(status: TuiAuthStatus): boolean {
  return status === "sign-in-required";
}

export function canStartDesignEngineer(status: TuiAuthStatus): boolean {
  return !requiresInteractiveAuthentication(status);
}

export function authStatusView(status: TuiAuthStatus): { readonly status: "ready" | "pending" | "not-configured"; readonly label: string } {
  if (status === "connected") return { status: "ready", label: "Connected" };
  if (status === "development-provider") return { status: "ready", label: "Development provider" };
  if (status === "sign-in-required") return { status: "pending", label: "Sign-in required" };
  return { status: "not-configured", label: "Not configured" };
}

