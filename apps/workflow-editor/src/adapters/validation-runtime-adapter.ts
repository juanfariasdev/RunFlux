import type { WorkflowDefinition } from '@runflux/workflow-model/types';
import type { NodeResult, PluginExecutionMode } from '@runflux/validation-runtime';

export type { NodeResult, PluginExecutionMode };

export interface ValidationRunOptions {
  mode: PluginExecutionMode;
  /** Aborting it closes the request, which cancels the run on the server. */
  signal?: AbortSignal;
  /** The project's variables, read by the nodes as `$env`. */
  environment?: Record<string, string>;
}

/**
 * Seam to the `validation-runtime` feature (003-validation-runtime, D-07 of
 * `002-workflow-editor`, extended here). The editor calls `run()` when the
 * user clicks "Test" (RF-06), after its own required-parameter check
 * (RF-12) has already passed; `runNode()` backs testing a single node in
 * isolation (RF-04), reusing `cachedResults` of nodes tested earlier as
 * upstream input (RN-03).
 */
export interface ValidationRuntimeAdapter {
  run(workflow: WorkflowDefinition, options: ValidationRunOptions): Promise<ValidationRunResult>;
  runNode(workflow: WorkflowDefinition, nodeId: string, options: ValidationRunOptions, cachedResults?: NodeResult[]): Promise<NodeResult>;
}

export interface ValidationRunResult {
  status: 'success' | 'error' | 'partial';
  /** Whether the run was stopped before every node ran. */
  cancelled?: boolean;
  message?: string;
  nodeResults: NodeResult[];
}

/** Reports success without running anything: a stand-in for tests that do not execute nodes. */
export class NoopValidationRuntimeAdapter implements ValidationRuntimeAdapter {
  async run(_workflow: WorkflowDefinition, _options: ValidationRunOptions): Promise<ValidationRunResult> {
    return { status: 'success', message: 'No-op validation: nothing was executed', nodeResults: [] };
  }

  async runNode(_workflow: WorkflowDefinition, nodeId: string, _options: ValidationRunOptions): Promise<NodeResult> {
    const now = new Date().toISOString();
    return { nodeId, input: undefined, output: null, error: null, startedAt: now, finishedAt: now };
  }
}

/**
 * Runs workflows on the editor's dev server. Plugin runtimes can only run in the Node process that
 * loaded them, so this adapter posts the workflow to the endpoint of
 * `vite-plugin-validation-runtime.ts`, which runs it with @runflux/validation-runtime (the engine
 * exported backends use) and answers with the result.
 */
export class HttpValidationRuntimeAdapter implements ValidationRuntimeAdapter {
  private readonly url: string;

  constructor(url: string = '/runflux-validate') {
    this.url = url;
  }

  async run(workflow: WorkflowDefinition, options: ValidationRunOptions): Promise<ValidationRunResult> {
    return this.post<ValidationRunResult>({ workflow, mode: options.mode, ...environmentOf(options) }, options.signal);
  }

  async runNode(workflow: WorkflowDefinition, nodeId: string, options: ValidationRunOptions, cachedResults: NodeResult[] = []): Promise<NodeResult> {
    return this.post<NodeResult>({ workflow, nodeId, mode: options.mode, cachedResults, ...environmentOf(options) }, options.signal);
  }

  private async post<T>(body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? `Validation request failed with status ${response.status}`);
    }
    return (await response.json()) as T;
  }
}

function environmentOf(options: ValidationRunOptions): { environment?: Record<string, string> } {
  return options.environment ? { environment: options.environment } : {};
}
