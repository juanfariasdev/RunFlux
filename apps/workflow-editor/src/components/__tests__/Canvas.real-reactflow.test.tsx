import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReactFlowProvider } from '@xyflow/react';
import { Canvas } from '../Canvas';
import { useWorkflowStore } from '../../store/workflow-store';
import type { PluginCatalogAdapter } from '../../adapters/plugin-catalog-adapter';

const catalog: PluginCatalogAdapter = {
  listPlugins: async () => ({
    trigger: [
      {
        id: 'trigger-manual-example',
        name: 'Manual Trigger',
        category: 'trigger',
        version: '1.0.0',
        parameters: [],
        supportedPlatforms: ['local'],
      },
    ],
  }),
  checkReference: async () => ({ status: 'ok' }),
};

describe('Canvas with REAL React Flow', () => {
  it('renders a subflow and a workflow node added to the store with visibility visible', async () => {
    useWorkflowStore.setState({
      workflow: {
        id: 'wf-test',
        name: 'Test Workflow',
        nodes: [
          {
            id: 'subflow-1',
            pluginId: 'runflux.subflow',
            pluginVersion: '1.0.0',
            parameters: {},
            position: { x: 100, y: 100 },
            appearance: { shape: 'subflow', label: 'My Subflow', width: 520, height: 300 },
          },
          {
            id: 'node-1',
            pluginId: 'trigger-manual-example',
            pluginVersion: '1.0.0',
            parameters: {},
            position: { x: 150, y: 150 },
            appearance: { shape: 'card', color: '#10b981', width: 220, height: 104 },
          },
        ],
        connections: [],
      },
      selectedNodeId: undefined,
    });

    const { container } = render(
      <div style={{ width: 1000, height: 800 }}>
        <ReactFlowProvider>
          <Canvas catalog={catalog} onSelectNode={() => {}} />
        </ReactFlowProvider>
      </div>
    );

    await waitFor(() => {
      const nodes = container.querySelectorAll('.react-flow__node');
      expect(nodes.length).toBe(2);
      expect((nodes[0] as HTMLElement).style.visibility).toBe('visible');
      expect((nodes[1] as HTMLElement).style.visibility).toBe('visible');
    });
  });

  it('adds and renders a node when dropped on the canvas with real ReactFlow', async () => {
    useWorkflowStore.setState({
      workflow: { id: 'wf-empty', name: 'Empty', nodes: [], connections: [] },
      selectedNodeId: undefined,
    });

    const { container } = render(
      <div style={{ width: 1000, height: 800 }}>
        <ReactFlowProvider>
          <Canvas catalog={catalog} onSelectNode={() => {}} />
        </ReactFlowProvider>
      </div>
    );

    const canvas = screen.getByTestId('canvas');
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperties(dropEvent, {
      clientX: { value: 300 },
      clientY: { value: 200 },
      dataTransfer: {
        value: {
          getData: (type: string) => (type === 'application/runflux-plugin-id' ? 'trigger-manual-example' : ''),
        },
      },
    });
    fireEvent(canvas, dropEvent);

    await waitFor(() => {
      expect(useWorkflowStore.getState().workflow.nodes).toHaveLength(1);
      const nodeElement = container.querySelector('.react-flow__node-workflowNode');
      expect(nodeElement).toBeInTheDocument();
      expect((nodeElement as HTMLElement).style.visibility).toBe('visible');
    });
  });
});
