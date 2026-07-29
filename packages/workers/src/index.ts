// packages/workers/src/index.ts
import { InMemoryWorkerRegistry } from "./registry";
import { designEngineer } from "./catalog/design-engineer";

export {
  InMemoryWorkerRegistry,
  WorkerNotFoundError,
  DuplicateWorkerError,
} from "./registry";

export { designEngineer } from "./catalog/design-engineer";

/** Every worker that ships with DesignFlow. */
export const BUILT_IN_WORKERS = [designEngineer] as const;

/**
 * A catalogue containing the built-in workers.
 *
 * A fresh registry per call rather than a shared singleton, so a host that
 * registers its own workers cannot leak them into another host — which matters
 * most in tests, where a leaked registration is a confusing failure two files
 * away.
 */
export function createWorkerRegistry(): InMemoryWorkerRegistry {
  return new InMemoryWorkerRegistry(BUILT_IN_WORKERS);
}
