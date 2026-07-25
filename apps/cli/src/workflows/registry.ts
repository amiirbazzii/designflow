import { workflowManifestSchema } from "@designflow/sdk";
import type { WorkflowManifest } from "@designflow/sdk";

export class WorkflowRegistry {
  private readonly manifests = new Map<string, WorkflowManifest>();

  public register(manifest: WorkflowManifest): void {
    const metadata = workflowManifestSchema.parse(manifest);
    this.manifests.set(metadata.id, manifest);
  }

  public get(id: string): WorkflowManifest | undefined {
    return this.manifests.get(id);
  }

  public list(): readonly WorkflowManifest[] {
    return Array.from(this.manifests.values());
  }
}
