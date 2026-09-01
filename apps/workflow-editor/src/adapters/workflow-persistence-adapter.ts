import type { WorkflowDefinition } from '../domain/types';

/**
 * Seam to the `workflow-project-management` feature (not yet built, D-07).
 * The editor calls `save()`/`load()` for RF-07 (persist state) — always
 * allowed even with empty required parameters (RN-04, unlike `run()` on
 * ValidationRuntimeAdapter, which the editor gates itself before calling).
 */
export interface WorkflowPersistenceAdapter {
  save(workflow: WorkflowDefinition): Promise<void>;
  load(workflowId: string): Promise<WorkflowDefinition | undefined>;
}

/**
 * Default in-memory implementation: persists only for the lifetime of the
 * page (a Map, not a database). Lets `workflow-editor` be built and tested
 * end-to-end before `workflow-project-management` exists. Swap for the real
 * adapter (backed by a database, per that feature's spec) once it lands.
 */
export class InMemoryWorkflowPersistenceAdapter implements WorkflowPersistenceAdapter {
  private store = new Map<string, WorkflowDefinition>();

  async save(workflow: WorkflowDefinition): Promise<void> {
    this.store.set(workflow.id, workflow);
  }

  async load(workflowId: string): Promise<WorkflowDefinition | undefined> {
    return this.store.get(workflowId);
  }
}
