import type { Logger } from '../contracts/services.js';
import type { NodeRecord } from './node-record.js';
import type { WorkflowExecution } from './workflow-execution.js';

export interface RunStartedEvent {
  readonly executionId: string;
  readonly workflowId: string;
  /** The trigger the run started at; undefined when every trigger started. */
  readonly triggerId?: string;
  readonly targetNodeId?: string;
  readonly startedAt: string;
}

export interface NodeStartedEvent {
  readonly executionId: string;
  readonly nodeId: string;
}

export interface NodeFinishedEvent {
  readonly executionId: string;
  readonly nodeId: string;
  /** What the run records for the node; undefined for a trigger that lost its race, which the run leaves out. */
  readonly record?: NodeRecord;
}

export interface RunFinishedEvent {
  readonly executionId: string;
  readonly execution: WorkflowExecution;
}

/**
 * Receives the progress of each run while it happens: execution history, live progress in the
 * editor, metrics and traces are observers. Callbacks may be asynchronous, but the run never waits
 * for them, and their failures are logged instead of reaching the run.
 */
export interface ExecutionObserver {
  runStarted?(event: RunStartedEvent): void | Promise<void>;
  nodeStarted?(event: NodeStartedEvent): void | Promise<void>;
  nodeFinished?(event: NodeFinishedEvent): void | Promise<void>;
  runFinished?(event: RunFinishedEvent): void | Promise<void>;
}

/** Delivers the events of one run, tagged with its execution id, to an observer. */
export class RunObservation {
  readonly executionId: string;
  private readonly observer: ExecutionObserver;
  private readonly logger: Logger;

  constructor(executionId: string, observer: ExecutionObserver, logger: Logger) {
    this.executionId = executionId;
    this.observer = observer;
    this.logger = logger;
  }

  runStarted(run: Omit<RunStartedEvent, 'executionId'>): void {
    this.deliver('runStarted', { executionId: this.executionId, ...run });
  }

  nodeStarted(nodeId: string): void {
    this.deliver('nodeStarted', { executionId: this.executionId, nodeId });
  }

  nodeFinished(nodeId: string, record?: NodeRecord): void {
    this.deliver('nodeFinished', { executionId: this.executionId, nodeId, ...(record ? { record } : {}) });
  }

  runFinished(execution: WorkflowExecution): void {
    this.deliver('runFinished', { executionId: this.executionId, execution });
  }

  private deliver<TName extends keyof ExecutionObserver>(name: TName, event: Parameters<NonNullable<ExecutionObserver[TName]>>[0]): void {
    const callback = this.observer[name] as ((event: unknown) => void | Promise<void>) | undefined;
    if (!callback) return;
    try {
      const result = callback.call(this.observer, event);
      if (result && typeof result.then === 'function') result.then(undefined, (error: unknown) => this.report(name, error));
    } catch (error) {
      this.report(name, error);
    }
  }

  private report(name: string, error: unknown): void {
    this.logger.error(`[RunFlux] Execution observer failed in ${name}:`, error);
  }
}
