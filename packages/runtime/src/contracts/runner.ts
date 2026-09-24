import type { WorkflowExecution } from '../engine/workflow-execution.js';
import type { ExecutableWorkflow } from '../workflow/executable-workflow.js';

export interface RunRequest {
  /** What the starting triggers receive as input. */
  readonly payload?: unknown;
  /** Start only this trigger; all triggers start when omitted. */
  readonly triggerId?: string;
  /** Cancels the run: running nodes see their signal abort and no further node starts. */
  readonly signal?: AbortSignal;
  /** Stops the run at this node, executing only the target and the upstream nodes it depends on. */
  readonly targetNodeId?: string;
}

/**
 * What the hosts (Express, Lambda, cron, CLI) need to serve a workflow: its document and a way to
 * run it. WorkflowEngine is one; a composition root may hand the hosts a runner that wraps the
 * engine instead (a queue, a concurrency limit, tracing). Hosts never dispose the runner; its
 * owner does.
 */
export interface WorkflowRunner {
  readonly workflow: ExecutableWorkflow;
  run(request: RunRequest): Promise<WorkflowExecution>;
}
