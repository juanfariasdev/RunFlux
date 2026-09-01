import type { WorkflowDefinition } from '../domain/types';

/**
 * Seam to the `validation-runtime` feature (not yet built, D-07). The editor
 * calls `run()` when the user clicks "Testar" (RF-06), after its own
 * required-parameter check (RF-12) has already passed.
 */
export interface ValidationRuntimeAdapter {
  run(workflow: WorkflowDefinition): Promise<ValidationRunResult>;
}

export interface ValidationRunResult {
  status: 'success' | 'error';
  message?: string;
}

/**
 * Default no-op implementation: reports success without actually running
 * anything. Lets `workflow-editor` be built and tested end-to-end before
 * `validation-runtime` exists. Swap for the real adapter once that feature lands.
 */
export class NoopValidationRuntimeAdapter implements ValidationRuntimeAdapter {
  async run(_workflow: WorkflowDefinition): Promise<ValidationRunResult> {
    return { status: 'success', message: 'validation-runtime not yet implemented (no-op)' };
  }
}
