import { describe, expect, test } from "bun:test";
import { capabilityManifestSchema } from "./capability-manifest";

describe("capability manifest schema", () => {
  test("accepts valid manifest", () => {
    const manifest = {
      id: "test-capability",
      name: "Test Capability",
      version: "1.0.0",
      type: "write_fs",
    };
    const result = capabilityManifestSchema.parse(manifest);
    expect(result.id).toBe("test-capability");
    expect(result.name).toBe("Test Capability");
    expect(result.version).toBe("1.0.0");
    expect(result.type).toBe("write_fs");
  });

  test("accepts manifest with all optional fields", () => {
    const manifest = {
      id: "test-capability",
      name: "Test Capability",
      version: "0.1.0",
      description: "A test capability",
      type: "pure",
      metadata: {
        author: "Test Author",
        tags: ["test", "demo"],
      },
    };
    const result = capabilityManifestSchema.parse(manifest);
    expect(result.description).toBe("A test capability");
    expect(result.metadata?.author).toBe("Test Author");
  });

  test("rejects missing id", () => {
    const manifest = {
      name: "Test Capability",
      version: "1.0.0",
      type: "write_fs",
    };
    expect(() => capabilityManifestSchema.parse(manifest)).toThrow();
  });

  test("rejects missing name", () => {
    const manifest = {
      id: "test-capability",
      version: "1.0.0",
      type: "write_fs",
    };
    expect(() => capabilityManifestSchema.parse(manifest)).toThrow();
  });

  test("rejects missing version", () => {
    const manifest = {
      id: "test-capability",
      name: "Test Capability",
      type: "write_fs",
    };
    expect(() => capabilityManifestSchema.parse(manifest)).toThrow();
  });

  test("rejects invalid version format", () => {
    const manifest = {
      id: "test-capability",
      name: "Test Capability",
      version: "invalid",
      type: "write_fs",
    };
    expect(() => capabilityManifestSchema.parse(manifest)).toThrow();
  });

  test("rejects missing type", () => {
    const manifest = {
      id: "test-capability",
      name: "Test Capability",
      version: "1.0.0",
    };
    expect(() => capabilityManifestSchema.parse(manifest)).toThrow();
  });

  test("rejects invalid type", () => {
    const manifest = {
      id: "test-capability",
      name: "Test Capability",
      version: "1.0.0",
      type: "invalid-type",
    };
    expect(() => capabilityManifestSchema.parse(manifest)).toThrow();
  });
});
