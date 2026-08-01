// packages/models/src/index.ts
export { InMemoryModelProfileRegistry } from "./profile-registry";
export { InMemoryModelProviderRegistry } from "./provider-registry";

export { ModelRuntime, DEFAULT_MODEL_TIMEOUT_MS } from "./runtime";
export type { ModelRuntimeOptions } from "./runtime";

export { mergeModelProfileOverrides } from "./config";
export type { ModelProfileOverride } from "./config";

export {
  MODEL_ERROR_CODES,
  PROVIDER_THROWABLE_CODES,
  DuplicateModelProfileError,
  DuplicateModelProviderError,
  ModelRequestInvalidError,
  ModelConfigurationInvalidError,
  ModelApiKeyMissingError,
  ModelResultInvalidError,
} from "./errors";
export type { ModelErrorCode } from "./errors";
