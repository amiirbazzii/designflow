// packages/core/src/composition/execution-service-resolver.ts
import {
  childExecutionRequestSchema,
  readExecutionLineage,
  workflowInvocationResultSchema,
  type ChildExecutionContract,
  type ExecutionRuntimeOptions,
  type WorkflowExecutionResolver,
  type WorkflowInvocation,
  type WorkflowInvocationContext,
  type WorkflowInvocationResult,
} from "@designflow/sdk";

/**
 * Adapts a `ChildExecutionContract` (implemented by `ExecutionService`) to the
 * SDK's `WorkflowExecutionResolver` contract.
 *
 * Constructed per execution and injected — never a global singleton.
 */
export class ExecutionServiceWorkflowResolver
  implements WorkflowExecutionResolver
{
  private readonly executionContract: ChildExecutionContract;

  public constructor(executionContract: ChildExecutionContract) {
    this.executionContract = executionContract;
  }

  public async executeWorkflow(
    invocation: WorkflowInvocation,
    context: WorkflowInvocationContext,
    runtime?: ExecutionRuntimeOptions,
  ): Promise<WorkflowInvocationResult> {
    const inheritedLineage = readExecutionLineage(context.metadata);

    const request = childExecutionRequestSchema.parse({
      workflowId: invocation.workflowId,
      input: invocation.input,
      metadata: invocation.metadata,
      lineage: {
        parentExecutionId: context.parentExecutionId,
        parentWorkflowId: context.parentWorkflowId,
        parentNodeId: context.parentNodeId,
        compositionPath: inheritedLineage.compositionPath,
      },
    });

    const result = await this.executionContract.executeChild(request, runtime);

    return workflowInvocationResultSchema.parse({
      executionId: result.executionId,
      workflowId: result.workflowId,
      status: result.status,
      artifacts: result.artifacts,
      error: result.error,
    });
  }
}
