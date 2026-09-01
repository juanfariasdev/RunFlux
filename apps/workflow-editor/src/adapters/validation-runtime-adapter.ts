import type { WorkflowDefinition } from '@runflux/workflow-model/types';
import type { NodeResult, PluginExecutionMode } from '@runflux/validation-runtime';

export type { NodeResult, PluginExecutionMode };

export interface ValidationRunOptions {
  mode: PluginExecutionMode;
}

/**
 * Seam to the `validation-runtime` feature (003-validation-runtime, D-07 of
 * `002-workflow-editor`, extended here). The editor calls `run()` when the
 * user clicks "Testar" (RF-06), after its own required-parameter check
 * (RF-12) has already passed; `runNode()` backs testing a single node in
 * isolation (RF-04).
 */
export interface ValidationRuntimeAdapter {
  run(workflow: WorkflowDefinition, options: ValidationRunOptions): Promise<ValidationRunResult>;
  runNode(workflow: WorkflowDefinition, nodeId: string, options: ValidationRunOptions): Promise<NodeResult>;
}

export interface ValidationRunResult {
  status: 'success' | 'error' | 'partial';
  message?: string;
  nodeResults: NodeResult[];
}

/**
 * Default no-op implementation: reports success without actually running
 * anything. Lets `workflow-editor` be built and tested end-to-end before
 * `validation-runtime` exists. Kept around as a lightweight stand-in for
 * tests that don't care about real execution.
 */
export class NoopValidationRuntimeAdapter implements ValidationRuntimeAdapter {
  async run(_workflow: WorkflowDefinition, _options: ValidationRunOptions): Promise<ValidationRunResult> {
    return { status: 'success', message: 'validation-runtime not yet implemented (no-op)', nodeResults: [] };
  }

  async runNode(_workflow: WorkflowDefinition, nodeId: string, _options: ValidationRunOptions): Promise<NodeResult> {
    const now = new Date().toISOString();
    return { nodeId, input: undefined, output: null, error: null, startedAt: now, finishedAt: now };
  }
}

/**
 * Browser-safe implementation (D-08, extended by a discovery made while
 * wiring this up): a plugin's `execute` is real JS, not JSON, so it can only
 * run in the Node process that actually loaded the plugin module — the same
 * constraint `HttpPluginCatalogAdapter` already works around for plugin
 * manifests (see plugin-catalog-adapter.ts). This adapter posts the
 * workflow to `vite-plugin-validation-runtime.ts`'s dev-only endpoint,
 * which runs it for real and returns the result as JSON.
 */
export class HttpValidationRuntimeAdapter implements ValidationRuntimeAdapter {
  private readonly url: string;

  constructor(url: string = '/runflux-validate') {
    this.url = url;
  }

  async run(workflow: WorkflowDefinition, options: ValidationRunOptions): Promise<ValidationRunResult> {
    return this.post<ValidationRunResult>({ workflow, mode: options.mode });
  }

  async runNode(workflow: WorkflowDefinition, nodeId: string, options: ValidationRunOptions): Promise<NodeResult> {
    return this.post<NodeResult>({ workflow, nodeId, mode: options.mode });
  }

  private async post<T>(body: Record<string, unknown>): Promise<T> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? `Validation request failed with status ${response.status}`);
    }
    return (await response.json()) as T;
  }
}
