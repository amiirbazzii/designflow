// packages/tools/src/index.ts
import { InMemoryToolRegistry } from "./registry";
import { classifyDesignTaskTool } from "./catalog/classify-design-task";
import { createProjectSummaryTool } from "./catalog/project-summary";
import type { Tool } from "@designflow/sdk";

export { InMemoryToolRegistry } from "./registry";

export { ToolRuntime } from "./runtime";
export type { ToolRuntimeOptions } from "./runtime";

export {
  TOOL_ERROR_CODES,
  ToolNotFoundError,
  DuplicateToolError,
  ToolCallInvalidError,
  ToolResultInvalidError,
} from "./errors";
export type { ToolErrorCode } from "./errors";

export {
  classifyDesignTaskTool,
  classifyDesignTaskManifest,
  classifyDesignTaskInputSchema,
  classifyDesignTaskOutputSchema,
  designTaskTypeSchema,
} from "./catalog/classify-design-task";
export type {
  ClassifyDesignTaskInput,
  ClassifyDesignTaskOutput,
  DesignTaskType,
} from "./catalog/classify-design-task";

export {
  createProjectSummaryTool,
  projectSummaryManifest,
  projectSummaryInputSchema,
  projectSummaryOutputSchema,
} from "./catalog/project-summary";
export type {
  ProjectSummaryInput,
  ProjectSummaryOutput,
  ProjectSummaryToolOptions,
} from "./catalog/project-summary";

export interface ToolCatalogOptions {
  /**
   * The directory `project-summary` is allowed to read.
   *
   * Optional, and the catalogue is smaller without it. A host that does not
   * say which directory may be inspected does not get a tool that inspects
   * directories — safer than defaulting to `process.cwd()` and hoping the
   * caller meant it.
   */
  readonly projectRoot?: string | undefined;
}

/**
 * The tools that ship with DesignFlow.
 *
 * A function rather than a constant because one of them needs a root, and a
 * constant would have to invent one.
 */
export function builtInTools(options?: ToolCatalogOptions): readonly Tool[] {
  const tools: Tool[] = [classifyDesignTaskTool];

  if (options?.projectRoot !== undefined) {
    tools.push(createProjectSummaryTool({ root: options.projectRoot }));
  }

  return tools;
}

/**
 * A registry containing the built-in tools.
 *
 * A fresh registry per call rather than a shared singleton, for the same
 * reason `createWorkerRegistry` and `createAgentRegistry` are: a host that
 * registers its own tools must not leak them into another.
 */
export function createToolRegistry(
  options?: ToolCatalogOptions,
): InMemoryToolRegistry {
  return new InMemoryToolRegistry(builtInTools(options));
}
