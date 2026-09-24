import type { WorkflowDefinition } from '@runflux/workflow-model/types';

/**
 * Seam to the `workflow-project-management` feature (D-07), implemented by
 * `HttpProjectApiAdapter`. The editor calls `save()`/`load()` for RF-07
 * (persist state) — always allowed even with empty required parameters
 * (RN-04, unlike `run()` on ValidationRuntimeAdapter, which the editor gates
 * itself before calling).
 */
export interface WorkflowPersistenceAdapter {
  save(workflow: WorkflowDefinition): Promise<void>;
  load(workflowId: string): Promise<WorkflowDefinition | undefined>;
}
