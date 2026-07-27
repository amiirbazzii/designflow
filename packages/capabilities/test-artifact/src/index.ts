// packages/capabilities/test-artifact/src/index.ts
import type { CapabilityProvider, CapabilityPackage } from "@designflow/sdk";
import { testArtifactManifest } from "./manifest";
import { testArtifactCapability } from "./capability";

export const provider: CapabilityProvider = {
  getCapability(): CapabilityPackage {
    return {
      manifest: testArtifactManifest,
      capability: testArtifactCapability,
    };
  },
};

export { testArtifactManifest } from "./manifest";
export { testArtifactCapability } from "./capability";
