// packages/models/src/errors.ts
import { DesignFlowError } from "@designflow/sdk";

/**
 * Model failures, each with a stable code.
 *
 * The same two shapes of failure `@designflow/tools` uses, for the same
 * reason:
 *
 *   **thrown**   — the caller misused the runtime, or the runtime's own
 *                  wiring is broken (a profile or provider that was never
 *                  registered). There is no request the failure can attach
 *                  to as data an agent should reason about; it is a
 *                  configuration problem, and it surfaces as one.
 *
 *   **returned** — a call was accepted and something about it — the network,
 *                  the provider, the model's own answer — went wrong. These
 *                  come back as `{type: "failure", code}` on a `ModelResult`,
 *                  because a model failure is information an agent should be
 *                  able to decide with, the same way a tool failure is.
 *
 * `MODEL_ERROR_CODES` is the enumeration the CLI's user-facing error table is
 * checked against, so a code added here without a message there fails a test
 * rather than reaching a person as raw internal text.
 */

export const MODEL_ERROR_CODES = [
  "ERR_MODEL_PROFILE_NOT_FOUND",
  "ERR_MODEL_PROFILE_ALREADY_REGISTERED",
  "ERR_MODEL_PROVIDER_NOT_FOUND",
  "ERR_MODEL_PROVIDER_ALREADY_REGISTERED",
  "ERR_MODEL_REQUEST_INVALID",
  "ERR_MODEL_RESPONSE_INVALID",
  "ERR_MODEL_OUTPUT_INVALID",
  "ERR_MODEL_OUTPUT_EMPTY",
  "ERR_MODEL_OUTPUT_JSON_INVALID",
  "ERR_MODEL_OUTPUT_TRUNCATED",
  "ERR_MODEL_AUTHENTICATION",
  "ERR_MODEL_RATE_LIMITED",
  "ERR_MODEL_UNAVAILABLE",
  "ERR_MODEL_TIMEOUT",
  "ERR_MODEL_ABORTED",
  "ERR_MODEL_PROVIDER_FAILED",
  "ERR_MODEL_CONFIGURATION_INVALID",
  "ERR_MODEL_API_KEY_MISSING",
  "ERR_MODEL_OUTPUT_UNSUPPORTED",
  "ERR_MODEL_SCHEMA_UNSUPPORTED",
] as const;

export type ModelErrorCode = (typeof MODEL_ERROR_CODES)[number];

export class DuplicateModelProfileError extends DesignFlowError {
  public constructor(profileId: string) {
    super(
      "ERR_MODEL_PROFILE_ALREADY_REGISTERED",
      `A model profile is already registered as: ${profileId}`,
      { profileId },
    );
    this.name = "DuplicateModelProfileError";
    Object.setPrototypeOf(this, DuplicateModelProfileError.prototype);
  }
}

export class DuplicateModelProviderError extends DesignFlowError {
  public constructor(providerId: string) {
    super(
      "ERR_MODEL_PROVIDER_ALREADY_REGISTERED",
      `A model provider is already registered as: ${providerId}`,
      { providerId },
    );
    this.name = "DuplicateModelProviderError";
    Object.setPrototypeOf(this, DuplicateModelProviderError.prototype);
  }
}

/**
 * The request handed to the runtime was not a request.
 *
 * Thrown rather than returned, mirroring `ToolCallInvalidError`: a malformed
 * `ModelInvocationRequest` (an empty `requestId`, no messages) is a
 * programming error in the caller, not something a well-formed request could
 * fail *at*.
 */
export class ModelRequestInvalidError extends DesignFlowError {
  public constructor(issues: readonly string[]) {
    super(
      "ERR_MODEL_REQUEST_INVALID",
      `Invalid model request: ${issues.join("; ")}`,
      { issues: [...issues] },
    );
    this.name = "ModelRequestInvalidError";
    Object.setPrototypeOf(this, ModelRequestInvalidError.prototype);
  }
}

/**
 * A profile failed local validation before anything was resolved.
 *
 * Raised by configuration merging (a local override that does not satisfy
 * `modelProfileSchema`) rather than by a live call — it is a setup mistake,
 * caught at the point setup happens rather than on the run that hits it.
 */
export class ModelConfigurationInvalidError extends DesignFlowError {
  public constructor(profileId: string, issues: readonly string[]) {
    super(
      "ERR_MODEL_CONFIGURATION_INVALID",
      `Model configuration for ${profileId} is invalid: ${issues.join("; ")}`,
      { profileId, issues: [...issues] },
    );
    this.name = "ModelConfigurationInvalidError";
    Object.setPrototypeOf(this, ModelConfigurationInvalidError.prototype);
  }
}

/**
 * A provider was asked to call out with no credential configured.
 *
 * Thrown at construction, before any network access — a provider adapter
 * checks this the moment it is built, never inside `generate()`, so a host
 * that requests model mode without a key fails while wiring the composition
 * root rather than mid-decision.
 */
export class ModelApiKeyMissingError extends DesignFlowError {
  public constructor(providerId: string, envVar: string) {
    super(
      "ERR_MODEL_API_KEY_MISSING",
      `No credential configured for model provider ${providerId}. Set ${envVar}.`,
      { providerId, envVar },
    );
    this.name = "ModelApiKeyMissingError";
    Object.setPrototypeOf(this, ModelApiKeyMissingError.prototype);
  }
}

/**
 * The runtime built a result that does not satisfy `modelResultSchema`.
 *
 * An internal invariant, not something a provider can cause directly — every
 * field placed on the result is derived by the runtime itself (a monotonic
 * clock, a constant code, a caller-supplied id), never taken from the
 * provider's own response. Shares `ERR_MODEL_RESPONSE_INVALID` with a
 * provider's own envelope failures deliberately: both describe "the response
 * this call ended up with does not validate," whichever layer produced it.
 */
export class ModelResultInvalidError extends DesignFlowError {
  public constructor(issues: readonly string[]) {
    super(
      "ERR_MODEL_RESPONSE_INVALID",
      `The runtime produced an invalid model result: ${issues.join("; ")}`,
      { issues: [...issues] },
    );
    this.name = "ModelResultInvalidError";
    Object.setPrototypeOf(this, ModelResultInvalidError.prototype);
  }
}

/**
 * The set of codes a provider adapter may throw and have passed through
 * verbatim by `ModelRuntime`.
 *
 * A provider throws a plain `DesignFlowError` with one of these codes — there
 * is no provider-specific error class to import, which is what keeps
 * `@designflow/model-provider-openrouter` free to depend on `@designflow/sdk`
 * alone. Anything a provider throws that is *not* one of these — a generic
 * `TypeError`, a network exception, an error with an unrecognised code — is
 * normalised to `ERR_MODEL_PROVIDER_FAILED` by the runtime rather than passed
 * through, so a provider cannot mint a code this system does not know about.
 */
export const PROVIDER_THROWABLE_CODES = [
  "ERR_MODEL_RESPONSE_INVALID",
  "ERR_MODEL_OUTPUT_INVALID",
  "ERR_MODEL_OUTPUT_EMPTY",
  "ERR_MODEL_OUTPUT_JSON_INVALID",
  "ERR_MODEL_OUTPUT_TRUNCATED",
  "ERR_MODEL_AUTHENTICATION",
  "ERR_MODEL_RATE_LIMITED",
  "ERR_MODEL_UNAVAILABLE",
  "ERR_MODEL_API_KEY_MISSING",
  "ERR_MODEL_SCHEMA_UNSUPPORTED",
] as const satisfies readonly ModelErrorCode[];
