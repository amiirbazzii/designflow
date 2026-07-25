import { describe, expect, test } from "bun:test";
import { workflowManifestSchema, semanticVersionSchema } from "./workflow-manifest";

describe("semantic version validation", () => {
  test("accepts valid semver versions", () => {
    expect(semanticVersionSchema.parse("1.0.0")).toBe("1.0.0");
    expect(semanticVersionSchema.parse("0.1.0")).toBe("0.1.0");
    expect(semanticVersionSchema.parse("2.10.3")).toBe("2.10.3");
    expect(semanticVersionSchema.parse("0.0.1")).toBe("0.0.1");
    expect(semanticVersionSchema.parse("100.200.300")).toBe("100.200.300");
  });

  test("rejects invalid versions", () => {
    expect(() => semanticVersionSchema.parse("1")).toThrow();
    expect(() => semanticVersionSchema.parse("abc")).toThrow();
    expect(() => semanticVersionSchema.parse("v1.0.0")).toThrow();
    expect(() => semanticVersionSchema.parse("1.0")).toThrow();
    expect(() => semanticVersionSchema.parse("1.0.0-beta")).toThrow();
    expect(() => semanticVersionSchema.parse("1.0.0+build")).toThrow();
    expect(() => semanticVersionSchema.parse("")).toThrow();
  });
});

describe("workflow manifest schema", () => {
  test("accepts valid manifest", () => {
    const manifest = {
      id: "test-workflow",
      name: "Test Workflow",
      version: "1.0.0",
    };
    const result = workflowManifestSchema.parse(manifest);
    expect(result.id).toBe("test-workflow");
    expect(result.name).toBe("Test Workflow");
    expect(result.version).toBe("1.0.0");
    expect(result.capabilities).toEqual([]);
  });

  test("accepts manifest with all optional fields", () => {
    const manifest = {
      id: "test-workflow",
      name: "Test Workflow",
      version: "0.1.0",
      description: "A test workflow",
      capabilities: ["cap-a", "cap-b"],
      compatibility: {
        minEngineVersion: "1.0.0",
        maxEngineVersion: "2.0.0",
      },
      metadata: {
        author: "Test Author",
        tags: ["test", "demo"],
      },
    };
    const result = workflowManifestSchema.parse(manifest);
    expect(result.description).toBe("A test workflow");
    expect(result.capabilities).toEqual(["cap-a", "cap-b"]);
    expect(result.compatibility?.minEngineVersion).toBe("1.0.0");
    expect(result.metadata?.author).toBe("Test Author");
  });

  test("rejects missing id", () => {
    const manifest = {
      name: "Test Workflow",
      version: "1.0.0",
    };
    expect(() => workflowManifestSchema.parse(manifest)).toThrow();
  });

  test("rejects missing name", () => {
    const manifest = {
      id: "test-workflow",
      version: "1.0.0",
    };
    expect(() => workflowManifestSchema.parse(manifest)).toThrow();
  });

  test("rejects missing version", () => {
    const manifest = {
      id: "test-workflow",
      name: "Test Workflow",
    };
    expect(() => workflowManifestSchema.parse(manifest)).toThrow();
  });

  test("rejects invalid version format", () => {
    const manifest = {
      id: "test-workflow",
      name: "Test Workflow",
      version: "invalid",
    };
    expect(() => workflowManifestSchema.parse(manifest)).toThrow();
  });

  test("rejects empty id", () => {
    const manifest = {
      id: "",
      name: "Test Workflow",
      version: "1.0.0",
    };
    expect(() => workflowManifestSchema.parse(manifest)).toThrow();
  });

  test("rejects empty name", () => {
    const manifest = {
      id: "test-workflow",
      name: "",
      version: "1.0.0",
    };
    expect(() => workflowManifestSchema.parse(manifest)).toThrow();
  });

  test("accepts valid compatibility range", () => {
    const manifest = {
      id: "test-workflow",
      name: "Test Workflow",
      version: "1.0.0",
      compatibility: {
        minEngineVersion: "1.0.0",
        maxEngineVersion: "2.0.0",
      },
    };
    const result = workflowManifestSchema.parse(manifest);
    expect(result.compatibility?.minEngineVersion).toBe("1.0.0");
    expect(result.compatibility?.maxEngineVersion).toBe("2.0.0");
  });

  test("accepts equal min and max versions", () => {
    const manifest = {
      id: "test-workflow",
      name: "Test Workflow",
      version: "1.0.0",
      compatibility: {
        minEngineVersion: "1.5.0",
        maxEngineVersion: "1.5.0",
      },
    };
    expect(() => workflowManifestSchema.parse(manifest)).not.toThrow();
  });

  test("rejects max < min version", () => {
    const manifest = {
      id: "test-workflow",
      name: "Test Workflow",
      version: "1.0.0",
      compatibility: {
        minEngineVersion: "2.0.0",
        maxEngineVersion: "1.0.0",
      },
    };
    expect(() => workflowManifestSchema.parse(manifest)).toThrow("maxEngineVersion must be >= minEngineVersion");
  });

  test("accepts only minEngineVersion", () => {
    const manifest = {
      id: "test-workflow",
      name: "Test Workflow",
      version: "1.0.0",
      compatibility: {
        minEngineVersion: "1.0.0",
      },
    };
    expect(() => workflowManifestSchema.parse(manifest)).not.toThrow();
  });

  test("accepts only maxEngineVersion", () => {
    const manifest = {
      id: "test-workflow",
      name: "Test Workflow",
      version: "1.0.0",
      compatibility: {
        maxEngineVersion: "2.0.0",
      },
    };
    expect(() => workflowManifestSchema.parse(manifest)).not.toThrow();
  });
});
