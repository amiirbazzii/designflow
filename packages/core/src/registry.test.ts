// packages/core/src/registry.test.ts
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { CapabilityRegistry, CapabilityRegistryError } from "./registry";
import type { Capability, CapabilityPackage } from "@designflow/sdk";

function createTestCapability(id: string): Capability<unknown, unknown> {
  return {
    id,
    name: `Test Capability ${id}`,
    description: `Test capability ${id}`,
    type: "pure",
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    async execute(_ctx, input) {
      return input;
    },
  };
}

function createTestPackage(id: string): CapabilityPackage {
  return {
    manifest: {
      id,
      name: `Test Capability ${id}`,
      version: "1.0.0",
      type: "pure",
    },
    capability: createTestCapability(id),
  };
}

describe("CapabilityRegistry", () => {
  test("registers capability via register() compatibility helper", () => {
    const registry = new CapabilityRegistry();
    const cap = createTestCapability("cap-1");
    registry.register(cap);
    expect(registry.has("cap-1")).toBe(true);
    expect(registry.get("cap-1")).toBe(cap);
    expect(registry.getManifest("cap-1")).toBeDefined();
    expect(registry.getManifest("cap-1")?.id).toBe("cap-1");
  });

  test("registers capability package via registerPackage()", () => {
    const registry = new CapabilityRegistry();
    const pkg = createTestPackage("cap-1");
    registry.registerPackage(pkg);
    expect(registry.has("cap-1")).toBe(true);
    expect(registry.get("cap-1")).toBe(pkg.capability);
    expect(registry.getPackage("cap-1")?.manifest).toEqual(pkg.manifest);
    expect(registry.getManifest("cap-1")).toEqual(pkg.manifest);
  });

  test("rejects duplicate capability ID via registerPackage()", () => {
    const registry = new CapabilityRegistry();
    const pkg1 = createTestPackage("cap-1");
    const pkg2 = createTestPackage("cap-1");
    registry.registerPackage(pkg1);
    expect(() => registry.registerPackage(pkg2)).toThrow("Duplicate capability ID");
  });

  test("rejects duplicate capability ID via register() compatibility", () => {
    const registry = new CapabilityRegistry();
    const cap1 = createTestCapability("cap-1");
    const cap2 = createTestCapability("cap-1");
    registry.register(cap1);
    expect(() => registry.register(cap2)).toThrow("Duplicate capability ID");
  });

  test("rejects invalid manifest", () => {
    const registry = new CapabilityRegistry();
    const invalidPkg = {
      manifest: {
        id: "test",
        // missing name, version, type
      },
      capability: createTestCapability("test"),
    };
    expect(() => registry.registerPackage(invalidPkg as never)).toThrow();
  });

  test("rejects capability id mismatch", () => {
    const registry = new CapabilityRegistry();
    const pkg: CapabilityPackage = {
      manifest: {
        id: "manifest-id",
        name: "Test",
        version: "1.0.0",
        type: "pure",
      },
      capability: createTestCapability("capability-id"),
    };
    expect(() => registry.registerPackage(pkg)).toThrow("capability.id must match manifest.id");
  });

  test("rejects capability type mismatch", () => {
    const registry = new CapabilityRegistry();
    const pkg: CapabilityPackage = {
      manifest: {
        id: "cap-1",
        name: "Test",
        version: "1.0.0",
        type: "pure",
      },
      capability: {
        ...createTestCapability("cap-1"),
        type: "write_fs",
      },
    };
    expect(() => registry.registerPackage(pkg)).toThrow("capability.type must match manifest.type");
  });

  test("lists registered capabilities", () => {
    const registry = new CapabilityRegistry();
    registry.registerPackage(createTestPackage("cap-1"));
    registry.registerPackage(createTestPackage("cap-2"));
    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list.map((c) => c.id)).toContain("cap-1");
    expect(list.map((c) => c.id)).toContain("cap-2");
  });

  test("lists packages", () => {
    const registry = new CapabilityRegistry();
    registry.registerPackage(createTestPackage("cap-1"));
    registry.registerPackage(createTestPackage("cap-2"));
    const packages = registry.listPackages();
    expect(packages).toHaveLength(2);
    expect(packages.map((p) => p.manifest.id)).toContain("cap-1");
    expect(packages.map((p) => p.manifest.id)).toContain("cap-2");
  });

  test("lists manifests", () => {
    const registry = new CapabilityRegistry();
    registry.registerPackage(createTestPackage("cap-1"));
    registry.registerPackage(createTestPackage("cap-2"));
    const manifests = registry.listManifests();
    expect(manifests).toHaveLength(2);
    expect(manifests.map((m) => m.id)).toContain("cap-1");
    expect(manifests.map((m) => m.id)).toContain("cap-2");
  });

  test("returns undefined for unknown capability", () => {
    const registry = new CapabilityRegistry();
    expect(registry.get("unknown")).toBeUndefined();
    expect(registry.getPackage("unknown")).toBeUndefined();
    expect(registry.getManifest("unknown")).toBeUndefined();
  });

  test("clears all capabilities", () => {
    const registry = new CapabilityRegistry();
    registry.registerPackage(createTestPackage("cap-1"));
    registry.registerPackage(createTestPackage("cap-2"));
    registry.clear();
    expect(registry.list()).toHaveLength(0);
    expect(registry.listPackages()).toHaveLength(0);
    expect(registry.listManifests()).toHaveLength(0);
  });
});
