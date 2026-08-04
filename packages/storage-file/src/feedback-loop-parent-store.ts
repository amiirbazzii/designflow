import {
  feedbackLoopParentRecordV1Schema,
  type FeedbackLoopParentRecordV1,
} from "@designflow/sdk";
import { FileStore, clone } from "./store";

export class FeedbackLoopParentAlreadyExistsError extends Error {
  public constructor(parentExecutionId: string) {
    super(`Feedback loop parent already exists: ${parentExecutionId}`);
  }
}

export class FileFeedbackLoopParentStore {
  private readonly store: FileStore;

  public constructor(store: FileStore) {
    this.store = store;
  }

  public async create(record: FeedbackLoopParentRecordV1): Promise<void> {
    const validated = feedbackLoopParentRecordV1Schema.parse(record);
    this.store.mutate((document) => {
      if (
        document.feedbackLoopParents[validated.parentExecutionId] !== undefined
      )
        throw new FeedbackLoopParentAlreadyExistsError(
          validated.parentExecutionId,
        );
      document.feedbackLoopParents[validated.parentExecutionId] = validated;
    });
  }

  public async get(
    parentExecutionId: string,
  ): Promise<FeedbackLoopParentRecordV1 | null> {
    const record = this.store.data.feedbackLoopParents[parentExecutionId];
    return record === undefined ? null : clone(record);
  }

  public async update(
    parentExecutionId: string,
    patch: Partial<Omit<FeedbackLoopParentRecordV1, "parentExecutionId">>,
  ): Promise<FeedbackLoopParentRecordV1 | null> {
    return this.store.mutate((document) => {
      const existing = document.feedbackLoopParents[parentExecutionId];
      if (existing === undefined) return null;
      const updated = feedbackLoopParentRecordV1Schema.parse({
        ...existing,
        ...patch,
        parentExecutionId,
      });
      document.feedbackLoopParents[parentExecutionId] = updated;
      return clone(updated);
    });
  }

  public async list(): Promise<readonly FeedbackLoopParentRecordV1[]> {
    return Object.values(this.store.data.feedbackLoopParents)
      .map((record) => clone(record))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
}
