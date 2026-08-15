import { describe, expect, test } from "bun:test";
import { defaultConfig, type Config } from "./config";
import {
  assembleDesignEngineerReadiness,
  buildDesignEngineerReadiness,
  describeFigmaMcp,
  describeRoleModelProfiles,
  readFigmaConnection,
  DESIGN_ROLE_ORDER,
  FEATURE_TIERS,
  type BrowserAvailability,
  type FigmaConnectionFacts,
  type ReadinessFacts,
} from "./readiness";

const BASE: ReadinessFacts = {
  credentialPresent: false,
  figma: { state: "missing" },
  projectCount: 0,
  playwrightPackageAvailable: false,
  browserAvailable: "not_checked",
  specificationDispatchAvailable: true,
  implementationDispatchAvailable: true,
  configPath: "/tmp/designflow-home/config.json",
  configExists: true,
  configParsed: true,
  version: "0.1.2",
};

function facts(overrides: Partial<ReadinessFacts> = {}): ReadinessFacts {
  return { ...BASE, ...overrides };
}

function configWith(figmaMcp: unknown): Config {
  const config = defaultConfig();
  config.settings["figmaMcp"] = figmaMcp;
  return config;
}

describe("model mode", () => {
  test("no credential is a deterministic fallback, not a failure", () => {
    const readiness = buildDesignEngineerReadiness(facts({ credentialPresent: false }));

    expect(readiness.modelMode).toBe("deterministic");
    expect(readiness.model.detail).toContain("Deterministic fallback");
    expect(readiness.model.nextStep).toContain("OPENROUTER_API_KEY");
  });

  test("a credential enables live reasoning and is never echoed", () => {
    const readiness = buildDesignEngineerReadiness(facts({ credentialPresent: true }));

    expect(readiness.modelMode).toBe("live");
    expect(readiness.model.nextStep).toBeUndefined();
    expect(JSON.stringify(readiness)).not.toContain("sk-");
  });
});

describe("figma connection", () => {
  test("missing configuration says to add one", () => {
    const readiness = buildDesignEngineerReadiness(facts({ figma: { state: "missing" } }));

    expect(readiness.figma.detail).toBe("No Figma connection is configured.");
    expect(readiness.figma.nextStep).toContain("Add a figmaMcp block");
    expect(readiness.figma.nextStep).toContain(BASE.configPath);
  });

  test("an unusable block says to fix the one already written", () => {
    const readiness = buildDesignEngineerReadiness(facts({ figma: { state: "invalid" } }));

    // The difference that matters: "you have not done this yet" versus
    // "what you wrote does not work".
    expect(readiness.figma.detail).toContain("does not describe a usable server");
    expect(readiness.figma.detail).toContain(BASE.configPath);
    expect(readiness.figma.nextStep).toContain("Fix the figmaMcp block");
  });

  test.each<[FigmaConnectionFacts, string]>([
    [{ state: "configured", transport: "stdio" }, "stdio server command"],
    [{ state: "configured", transport: "http" }, "local HTTP endpoint"],
  ])("a configured %o names its transport", (figma, expected) => {
    const readiness = buildDesignEngineerReadiness(facts({ figma }));

    expect(readiness.figma.detail).toContain(expected);
    expect(readiness.figma.transport).toBe(figma.transport);
  });
});

describe("projects", () => {
  test("none registered still allows a specification", () => {
    const readiness = buildDesignEngineerReadiness(
      facts({ figma: { state: "configured", transport: "stdio" }, projectCount: 0 }),
    );

    expect(readiness.projects.nextStep).toContain(
      "designflow projects add --name <name> --path <path>",
    );
    expect(readiness.specification.ready).toBe(true);
    expect(readiness.implementationProposal.ready).toBe(false);
  });

  test.each([
    [1, "1 project registered."],
    [3, "3 projects registered."],
  ])("%i registered reads naturally", (count, expected) => {
    const readiness = buildDesignEngineerReadiness(facts({ projectCount: count }));

    expect(readiness.projects.detail).toBe(expected);
    expect(readiness.projects.nextStep).toBeUndefined();
  });
});

describe("visual validation", () => {
  test.each<[Partial<ReadinessFacts>, string]>([
    [{ playwrightPackageAvailable: false }, "Playwright package is not installed"],
    [
      { playwrightPackageAvailable: true, browserAvailable: "not_checked" as BrowserAvailability },
      "a browser launch was not attempted",
    ],
    [{ playwrightPackageAvailable: true, browserAvailable: false }, "Chromium could not be launched"],
    [{ playwrightPackageAvailable: true, browserAvailable: true }, "Playwright and Chromium are available"],
  ])("distinguishes package from browser (%o)", (overrides, expected) => {
    expect(buildDesignEngineerReadiness(facts(overrides)).visualValidation.detail).toContain(expected);
  });
});

describe("journeys", () => {
  test("does not report a journey ready unless its canonical dispatch path is registered", () => {
    const specificationBlocked = buildDesignEngineerReadiness(
      facts({
        figma: { state: "configured", transport: "http" },
        specificationDispatchAvailable: false,
      }),
    );
    expect(specificationBlocked.specification.ready).toBe(false);
    expect(specificationBlocked.specification.reasons.join(" ")).toContain("unavailable");

    const implementationBlocked = buildDesignEngineerReadiness(
      facts({
        figma: { state: "configured", transport: "http" },
        projectCount: 1,
        implementationDispatchAvailable: false,
      }),
    );
    expect(implementationBlocked.implementationProposal.ready).toBe(false);
    expect(implementationBlocked.implementationProposal.reasons.join(" ")).toContain("unavailable");
  });

  test("specification is blocked by figma alone", () => {
    const blocked = buildDesignEngineerReadiness(facts({ figma: { state: "invalid" } }));
    expect(blocked.specification.ready).toBe(false);
    expect(blocked.specification.reasons).toHaveLength(1);

    const ready = buildDesignEngineerReadiness(
      facts({ figma: { state: "configured", transport: "http" } }),
    );
    expect(ready.specification.ready).toBe(true);
    expect(ready.specification.reasons).toEqual([]);
  });

  test("implementation needs figma and a project, and still needs consent and approval", () => {
    const both = buildDesignEngineerReadiness(facts({ figma: { state: "missing" }, projectCount: 0 }));
    expect(both.implementationProposal.ready).toBe(false);
    expect(both.implementationProposal.reasons).toHaveLength(2);

    const ready = buildDesignEngineerReadiness(
      facts({ figma: { state: "configured", transport: "stdio" }, projectCount: 2 }),
    );
    expect(ready.implementationProposal.ready).toBe(true);

    // Ready to *ask*, never pre-authorized: both gates are stated even when
    // nothing is in the way.
    const notes = ready.implementationProposal.notes.join(" ");
    expect(notes).toContain("consent");
    expect(notes).toContain("approve the exact proposed changes");
  });

  test("visual correction is beta and not yet connected", () => {
    const readiness = buildDesignEngineerReadiness(
      facts({ figma: { state: "configured", transport: "stdio" }, projectCount: 1 }),
    );

    expect(readiness.visualCorrection).toBe("beta_unconnected");
    expect(readiness.visualCorrectionDetail).toContain("Beta");
    expect(readiness.visualCorrectionDetail).toContain("not yet connected");
  });
});

describe("configuration", () => {
  test.each<[Partial<ReadinessFacts>, string]>([
    [{ configExists: false }, "built-in defaults are in effect"],
    [{ configParsed: false }, "could not be read as valid configuration"],
    [{}, "(read, valid)"],
  ])("reports the config file honestly (%o)", (overrides, expected) => {
    expect(buildDesignEngineerReadiness(facts(overrides)).configuration.detail).toContain(expected);
  });
});

describe("readFigmaConnection", () => {
  test("absent is missing, present-but-unparseable is invalid", () => {
    expect(readFigmaConnection(defaultConfig()).state).toBe("missing");
    expect(readFigmaConnection(configWith({ transport: "stdio" })).state).toBe("invalid");
    expect(readFigmaConnection(configWith({ transport: "http" })).state).toBe("invalid");
    expect(readFigmaConnection(configWith("nonsense")).state).toBe("missing");
  });

  test("a usable block is configured, with its transport", () => {
    expect(readFigmaConnection(configWith({ command: "figma-server" }))).toEqual({
      state: "configured",
      transport: "stdio",
    });
    expect(
      readFigmaConnection(configWith({ transport: "http", url: "http://127.0.0.1:3845/mcp" })),
    ).toEqual({ state: "configured", transport: "http" });
  });
});

describe("describeFigmaMcp", () => {
  test("a local endpoint is reduced to host and port", () => {
    const display = describeFigmaMcp(
      configWith({ transport: "http", url: "http://127.0.0.1:3845/mcp?token=secret-value" }),
    );

    expect(display.target).toBe("127.0.0.1:3845");
    expect(JSON.stringify(display)).not.toContain("secret-value");
  });

  test("a server command is reduced to its basename, and only variable names are shown", () => {
    const display = describeFigmaMcp(
      configWith({
        command: "/opt/private/tools/figma-server",
        args: ["--token", "secret-value"],
        envPassthrough: ["FIGMA_ACCESS_TOKEN"],
      }),
    );

    expect(display.target).toBe("figma-server");
    expect(display.envPassthroughNames).toEqual(["FIGMA_ACCESS_TOKEN"]);
    expect(JSON.stringify(display)).not.toContain("secret-value");
    expect(JSON.stringify(display)).not.toContain("/opt/private");
  });
});

describe("assembleDesignEngineerReadiness", () => {
  test("derives the figma state from the config it is given", () => {
    const readiness = assembleDesignEngineerReadiness({
      config: configWith({ transport: "http" }),
      configPath: "/tmp/config.json",
      configExists: true,
      configParsed: true,
      credentialPresent: false,
      projectCount: 0,
      playwrightPackageAvailable: false,
      browserAvailable: "not_checked",
      specificationDispatchAvailable: false,
      implementationDispatchAvailable: false,
      version: "0.1.2",
    });

    expect(readiness.figma.state).toBe("invalid");
    expect(readiness.specification.ready).toBe(false);
  });
});

describe("roles", () => {
  test("every role is named, and an override is attributed field by field", () => {
    const views = describeRoleModelProfiles(
      DESIGN_ROLE_ORDER.map((roleId, index) => ({
        roleId,
        profileId: `profile-${index}`,
        effective: { providerId: "openrouter", model: index === 1 ? "override/model" : "built/model", temperature: 0.2 },
        builtIn: { providerId: "openrouter", model: "built/model" },
      })),
    );

    expect(views.map((view) => view.roleName)).toEqual([
      "Design Interpreter",
      "Project Mapper",
      "UI Builder",
      "Visual Critic",
    ]);

    const overridden = views[1];
    expect(overridden?.fields.find((field) => field.label === "Model")?.source).toBe("override");
    expect(overridden?.fields.find((field) => field.label === "Provider")?.source).toBe("built-in");
    // A value the built-in did not set at all is an override when present.
    expect(overridden?.fields.find((field) => field.label === "Temperature")?.source).toBe("override");

    expect(views[0]?.fields.find((field) => field.label === "Model")?.source).toBe("built-in");
  });
});

describe("feature tiers", () => {
  test("claims are labeled and none of them claims production readiness", () => {
    expect(FEATURE_TIERS.map((tier) => tier.tier)).toEqual([
      "supported",
      "supported",
      "beta",
      "compatibility-only",
    ]);

    const text = JSON.stringify(FEATURE_TIERS).toLowerCase();
    expect(text).not.toContain("production");
    expect(text).toContain("approval");
  });
});
