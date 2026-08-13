// packages/tools/src/project-context/index.ts
//
// The deterministic Project Context compiler. See ./README.md.
export {
  compileProjectContext,
  PROJECT_CONTEXT_COMPILER_VERSION,
  MAX_COMPONENT_INVENTORY,
  MAX_DESTINATIONS,
  type CompileProjectContextOptions,
} from "./project-context-compiler";

export { inspectProjectAliases, MAX_EXTENDS_DEPTH, type AliasInspection } from "./alias-inspector";

export {
  selectDurableProjectFacts,
  durableFactsAreCurrent,
  durableFactChanges,
  DURABLE_FACT_KEYS,
  type DurableFactKey,
} from "./durable-fact-bridge";
