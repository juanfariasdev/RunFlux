import { WorkflowEngine, type ExecutionResponse } from '@runflux/runtime';
import { plugins } from '@runflux/runtime/plugins';
import document from './workflow.json' with { type: 'json' };

/** The engine of this backend's workflow, shared by all of its entry points. */
export const engine = WorkflowEngine.fromDocument(document, plugins);

/** Runs the workflow once, starting only `triggerId` when given, and returns the response body. */
export async function runWorkflow(payload: unknown = {}, triggerId?: string): Promise<ExecutionResponse> {
  return (await engine.run({ payload, triggerId })).toResponse();
}
