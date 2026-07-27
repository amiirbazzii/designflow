// packages/capabilities/test-artifact/src/provider.ts
import type { CapabilityProvider, CapabilityPackage } from "@designflow/sdk";
import { testArtifactManifest } from "./manifest";
import { testArtifactCapability } from "./capability";

export const testArtifactProvider: CapabilityProvider = {
  getCapability(): CapabilityPackage {
    return {
      manifest: testArtifactManifest,
      capability: testArtifactCapability,
    };
  },
};
