import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Toolbar } from '../Toolbar';
import { useWorkflowStore } from '../../store/workflow-store';
import type { PluginCatalogAdapter } from '../../adapters/plugin-catalog-adapter';
import type { ValidationRuntimeAdapter } from '../../adapters/validation-runtime-adapter';
import type { WorkflowPersistenceAdapter } from '../../adapters/workflow-persistence-adapter';
import type { PluginManifest } from '@runflux/plugin-system/types';

const manifestWithRequiredField: PluginManifest = {
  id: 'action-example',
  name: 'Example Action',
  category: 'action',
  version: '1.0.0',
  parameters: [{ name: 'url', label: 'URL', type: 'string', required: true }],
  supportedPlatforms: ['local'],
};

function fakeCatalog(): PluginCatalogAdapter {
  return {
    listPlugins: async () => ({ action: [manifestWithRequiredField] }),
    checkReference: async () => ({ status: 'ok' }),
  };
}

beforeEach(() => {
  useWorkflowStore.setState({
    workflow: { id: 'wf-1', name: 'My Workflow', nodes: [], connections: [] },
    selectedNodeId: undefined,
  });
});

describe('Toolbar — Save (RF-07, RN-04)', () => {
  it('saves the workflow even with a required parameter left empty', async () => {
    useWorkflowStore.getState().addNode({
      id: 'n1',
      pluginId: 'action-example',
      pluginVersion: '1.0.0',
      parameters: { url: '' },
      position: { x: 0, y: 0 },
    });

    const save = vi.fn().mockResolvedValue(undefined);
    const persistence: WorkflowPersistenceAdapter = { save, load: vi.fn() };
    const validation: ValidationRuntimeAdapter = { run: vi.fn(), runNode: vi.fn() };

    render(<Toolbar catalog={fakeCatalog()} persistence={persistence} validation={validation} />);
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });
});

describe('Toolbar — Test (RF-06, RF-12, RN-04)', () => {
  it('blocks testing when a required parameter is empty, without calling the validation runtime', async () => {
    useWorkflowStore.getState().addNode({
      id: 'n1',
      pluginId: 'action-example',
      pluginVersion: '1.0.0',
      parameters: { url: '' },
      position: { x: 0, y: 0 },
    });

    const run = vi.fn();
    render(
      <Toolbar
        catalog={fakeCatalog()}
        persistence={{ save: vi.fn(), load: vi.fn() }}
        validation={{ run, runNode: vi.fn() }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /test/i }));

    await screen.findByText(/fill required fields on node n1/i);
    expect(run).not.toHaveBeenCalled();
  });

  it('calls the validation runtime when all required parameters are filled', async () => {
    useWorkflowStore.getState().addNode({
      id: 'n1',
      pluginId: 'action-example',
      pluginVersion: '1.0.0',
      parameters: { url: 'https://example.com' },
      position: { x: 0, y: 0 },
    });

    const run = vi.fn().mockResolvedValue({ status: 'success', message: 'ok' });
    render(
      <Toolbar
        catalog={fakeCatalog()}
        persistence={{ save: vi.fn(), load: vi.fn() }}
        validation={{ run, runNode: vi.fn() }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /test/i }));

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('ok')).toBeInTheDocument();
  });
});
