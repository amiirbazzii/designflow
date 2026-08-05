// Compatibility entry point. New core code should import from
// `application/execution`; this path remains for existing consumers.
export { ExecutionService } from "../application/execution";
export type { WorkflowResolver, ExecutionServiceConfig } from "../application/execution";
export { WorkflowNotFoundError, InvalidRequestError } from "../application/execution";
