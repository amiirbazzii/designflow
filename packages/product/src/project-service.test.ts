// packages/product/src/project-service.test.ts
import { describe, expect, test } from "bun:test";
import { InMemoryProjectContextStore, InMemoryProjectStore } from "./project-store";
import { ProjectContextService } from "./project-context-service";
import { ProjectService } from "./project-service";
import type { ProjectInspector } from "./project-service";

const NOW = "2026-08-01T00:00:00.000Z";

interface ProjectFactCandidateLocal {
  key: string;
  value: unknown;
  source: "inspection" | "inferred";
  confidence?: number;
}

function stubInspector(facts: readonly ProjectFactCandidateLocal[]): ProjectInspector {
  return { inspect: async () => ({ facts }) };
}

function build(inspector?: ProjectInspector) {
  const store = new InMemoryProjectStore();
  const contextStore = new InMemoryProjectContextStore();
  const context = new ProjectContextService({ store: contextStore, now: () => NOW });
  const service = new ProjectService({ store, context, inspector, now: () => NOW });
  return { service, context };
}

describe("ProjectService", () => {
  test("createProject normalizes redundant separators and stamps timestamps", async () => {
    const { service } = build();
    const project = await service.createProject({ name: "Storefront", rootPath: "/tmp//storefront//" });

    expect(project.name).toBe("Storefront");
    expect(project.rootPath).toBe("/tmp/storefront");
    expect(project.createdAt).toBe(NOW);
  });

  test("createProject rejects a blank rootPath", async () => {
    const { service } = build();
    await expect(service.createProject({ name: "Storefront", rootPath: "   " })).rejects.toMatchObject({
      code: "ERR_PROJECT_PATH_INVALID",
    });
  });

  test("getProject throws for an unknown id", async () => {
    const { service } = build();
    await expect(service.getProject("nope")).rejects.toMatchObject({ code: "ERR_PROJECT_NOT_FOUND" });
  });

  test("inspectProject merges facts into project context", async () => {
    const facts: ProjectFactCandidateLocal[] = [
      { key: "project.framework", value: "react", source: "inspection" },
      { key: "designSystem.path", value: "ui", source: "inferred", confidence: 0.5 },
    ];
    const { service, context } = build(stubInspector(facts));

    const project = await service.createProject({ name: "Storefront", rootPath: "/tmp/storefront" });
    await service.inspectProject(project.id);

    const stored = await context.getContext(project.id);
    expect(stored.facts.map((f) => f.key).sort()).toEqual(["designSystem.path", "project.framework"]);
    expect(stored.facts.find((f) => f.key === "designSystem.path")?.source).toBe("inferred");
  });

  test("inspectProject refuses a project with no rootPath", async () => {
    const { service } = build(stubInspector([]));
    const project = await service.createProject({ name: "Storefront" });

    await expect(service.inspectProject(project.id)).rejects.toMatchObject({
      code: "ERR_PROJECT_INVALID",
    });
  });

  test("inspectProject refuses when no inspector is configured", async () => {
    const { service } = build();
    const project = await service.createProject({ name: "Storefront", rootPath: "/tmp/storefront" });

    await expect(service.inspectProject(project.id)).rejects.toMatchObject({
      code: "ERR_PROJECT_INVALID",
    });
  });
});
