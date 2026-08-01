// packages/models/src/profile-registry.ts
import { modelProfileSchema, type ModelProfile } from "@designflow/sdk";
import { DuplicateModelProfileError } from "./errors";

/**
 * The model profile catalogue.
 *
 * Registration and resolution only, exactly like `InMemoryToolRegistry` and
 * `InMemoryAgentRegistry`. Nothing here calls a provider or makes a network
 * request — that is `ModelRuntime`'s job — so a host can list what is
 * configured without the listing being a way to spend a token.
 *
 * A profile is a reference: `providerId` and `model`, never a credential. The
 * registry is therefore safe to expose freely — `designflow settings` reads
 * it directly to show safe model assignments — with nothing to redact.
 */
export class InMemoryModelProfileRegistry {
  private readonly profiles = new Map<string, ModelProfile>();

  public constructor(initial: readonly ModelProfile[] = []) {
    for (const profile of initial) this.register(profile);
  }

  /**
   * Adds a profile, validating it at the boundary.
   *
   * A duplicate id is refused rather than overwritten. An agent's
   * `modelProfileId` names a profile by id, so silently replacing one would
   * change what a reviewed configuration actually points at — the same
   * failure every other registry in this codebase refuses for the same
   * reason.
   */
  public register(profile: ModelProfile): void {
    const validated = modelProfileSchema.parse(profile);

    if (this.profiles.has(validated.id)) {
      throw new DuplicateModelProfileError(validated.id);
    }

    this.profiles.set(validated.id, validated);
  }

  public get(profileId: string): ModelProfile | undefined {
    return this.profiles.get(profileId);
  }

  public has(profileId: string): boolean {
    return this.profiles.has(profileId);
  }

  /** The registered ids, for narrowing what an agent may be told is available. */
  public ids(): readonly string[] {
    return [...this.profiles.keys()];
  }

  /** Every registered profile, in registration order. Safe to expose whole. */
  public list(): readonly ModelProfile[] {
    return [...this.profiles.values()];
  }
}
