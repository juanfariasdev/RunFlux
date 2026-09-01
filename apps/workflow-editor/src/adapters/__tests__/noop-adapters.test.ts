import { describe, expect, it } from 'vitest';
import { NoopValidationRuntimeAdapter } from '../validation-runtime-adapter';
import { InMemoryWorkflowPersistenceAdapter } from '../workflow-persistence-adapter';
import type { WorkflowDefinition } from '@runflux/workflow-model/types';

const workflow: WorkflowDefinition = {
  id: 'wf-1',
  name: 'Test Workflow',
  nodes: [],
  connections: [],
};

describe('NoopValidationRuntimeAdapter', () => {
  it('always resolves run() with status "success" and an empty nodeResults, and never throws', async () => {
    const adapter = new NoopValidationRuntimeAdapter();
    const result = await adapter.run(workflow, { mode: 'sandbox' });
    expect(result.status).toBe('success');
    expect(result.nodeResults).toEqual([]);
  });

  it('always resolves runNode() with a result carrying no error', async () => {
    const adapter = new NoopValidationRuntimeAdapter();
    const result = await adapter.runNode(workflow, 'n1', { mode: 'sandbox' });
    expect(result.nodeId).toBe('n1');
    expect(result.error).toBeNull();
  });
});

describe('InMemoryWorkflowPersistenceAdapter', () => {
  it('returns undefined when loading a workflow that was never saved', async () => {
    const adapter = new InMemoryWorkflowPersistenceAdapter();
    expect(await adapter.load('does-not-exist')).toBeUndefined();
  });

  it('round-trips a saved workflow through load()', async () => {
    const adapter = new InMemoryWorkflowPersistenceAdapter();
    await adapter.save(workflow);
    expect(await adapter.load('wf-1')).toEqual(workflow);
  });

  it('overwrites a previous save for the same workflow id', async () => {
    const adapter = new InMemoryWorkflowPersistenceAdapter();
    await adapter.save(workflow);
    const updated = { ...workflow, name: 'Renamed' };
    await adapter.save(updated);
    expect(await adapter.load('wf-1')).toEqual(updated);
  });

  it('keeps two different workflow ids independent', async () => {
    const adapter = new InMemoryWorkflowPersistenceAdapter();
    await adapter.save(workflow);
    await adapter.save({ ...workflow, id: 'wf-2', name: 'Other' });
    expect((await adapter.load('wf-1'))?.name).toBe('Test Workflow');
    expect((await adapter.load('wf-2'))?.name).toBe('Other');
  });
});
