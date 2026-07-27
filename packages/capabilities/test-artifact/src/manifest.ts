// packages/capabilities/test-artifact/src/manifest.ts
import type { CapabilityManifest } from "@designflow/sdk";

export const testArtifactManifest: CapabilityManifest = {
  id: "test-artifact",
  name: "Test Artifact",
  version: "0.1.0",
  description: "Creates a test artifact with a provided message",
  type: "write_fs",
  metadata: {
    author: "DesignFlow Team",
    tags: ["test", "artifact"],
  },
};
