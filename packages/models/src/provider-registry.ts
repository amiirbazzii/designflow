// packages/models/src/provider-registry.ts
import type { ModelProvider } from "@designflow/sdk";
import { DuplicateModelProviderError, ModelConfigurationInvalidError } from "./errors";

/**
 * The provider catalogue.
 *
 * Registration and resolution only. A provider is a concrete adapter — the
 * OpenRouter package, later a direct Anthropic or OpenAI one — and this
 * registry is domain-agnostic about which: it knows providers have an `id`
 * and can `generate`, nothing else. `ModelRuntime` is the only thing that
 * ever calls `generate` on what this holds.
 *
 * Unlike `InMemoryModelProfileRegistry`, this is never handed to an agent or
 * exposed by a product read API — a provider object holds whatever the
 * concrete adapter closed over to reach its API (an HTTP client, in
 * OpenRouter's case), and listing providers freely the way profiles are
 * listed would risk exposing that.
 */
export class InMemoryModelProviderRegistry {
  private readonly providers = new Map<string, ModelProvider>();

  public constructor(initial: readonly ModelProvider[] = []) {
    for (const provider of initial) this.register(provider);
  }

  /**
   * Adds a provider.
   *
   * A duplicate id is refused rather than overwritten, for the same reason
   * every other registry in this codebase refuses one: a profile's
   * `providerId` would otherwise resolve to whichever provider registered
   * last.
   */
  public register(provider: ModelProvider): void {
    if (provider.id.length === 0) {
      throw new ModelConfigurationInvalidError("(unnamed)", [
        "provider id must not be empty",
      ]);
    }

    if (this.providers.has(provider.id)) {
      throw new DuplicateModelProviderError(provider.id);
    }

    this.providers.set(provider.id, provider);
  }

  public get(providerId: string): ModelProvider | undefined {
    return this.providers.get(providerId);
  }

  public ids(): readonly string[] {
    return [...this.providers.keys()];
  }
}
