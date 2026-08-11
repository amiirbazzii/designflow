import { describe, expect, test } from "bun:test";
import {
  authStatusView,
  canStartDesignEngineer,
  requiresInteractiveAuthentication,
  type TuiAuthController,
} from "./auth";
import { buildSessionView } from "./model";
import { initialNavigationState, navigateBack, openSignInRequired, openSigningIn } from "./navigation";

describe("DesignFlow TUI authentication gate", () => {
  test("missing authentication is pending and cannot start Design Engineer", () => {
    const session = buildSessionView({ figma: "connected", ai: "sign-in-required", project: { name: "Spendly" } });

    expect(session.ai).toEqual({ status: "pending", label: "Sign-in required" });
    expect(requiresInteractiveAuthentication("sign-in-required")).toBe(true);
    expect(canStartDesignEngineer("sign-in-required")).toBe(false);
    expect(authStatusView("sign-in-required")).toEqual({ status: "pending", label: "Sign-in required" });
  });

  test("valid persisted sessions skip the sign-in gate", () => {
    expect(requiresInteractiveAuthentication("connected")).toBe(false);
    expect(requiresInteractiveAuthentication("development-provider")).toBe(false);
    expect(canStartDesignEngineer("connected")).toBe(true);
    expect(authStatusView("connected")).toEqual({ status: "ready", label: "Connected" });
  });

  test("the TUI controller delegates sign-in to the existing auth service once", async () => {
    let calls = 0;
    const auth: TuiAuthController = {
      status: () => "sign-in-required",
      signInWithGoogle: async () => {
        calls += 1;
        return "connected";
      },
    };

    const status = await auth.signInWithGoogle();
    expect(calls).toBe(1);
    expect(status).toBe("connected");
  });

  test("authentication navigation is explicit and back-safe", () => {
    const required = openSignInRequired(initialNavigationState());
    const signingIn = openSigningIn(required);

    expect(required.view).toBe("sign-in-required");
    expect(signingIn.view).toBe("signing-in");
    expect(navigateBack(signingIn).view).toBe("sign-in-required");
    expect(navigateBack(required).view).toBe("start");
  });
});

