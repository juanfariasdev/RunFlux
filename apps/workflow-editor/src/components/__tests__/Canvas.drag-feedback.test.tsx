import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginCatalogAdapter } from '../../adapters/plugin-catalog-adapter';
import { useWorkflowStore } from '../../store/workflow-store';
import { Canvas } from '../Canvas';

vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual<typeof import('@xyflow/react')>('@xyflow/react');

  return {
    ...actual,
    ReactFlow: ({ children, onDrop, nodes = [] }: React.HTMLAttributes<HTMLDivElement> & { nodes?: unknown[] }) => (
      <div
        data-testid="react-flow-pane"
        data-node-count={nodes.length}
        onDrop={(event) => {
          onDrop?.(event);
          event.stopPropagation();
        }}
      >
        {children}
      </div>
    ),
    Background: () => null,
    Controls: () => null,
    MiniMap: () => null,
    Panel: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    useReactFlow: () => ({
      screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
      fitView: vi.fn(),
    }),
  };
});

const catalog: PluginCatalogAdapter = {
  listPlugins: async () => ({}),
  checkReference: async () => ({ status: 'missing' }),
};

beforeEach(() => {
  useWorkflowStore.setState({
    workflow: { id: 'wf-test', name: 'Test', nodes: [], connections: [] },
    selectedNodeId: undefined,
  });
});

describe('Canvas external drag feedback', () => {
  it('visually marks the canvas as an active drop target while a palette item is over it', () => {
    render(<Canvas catalog={catalog} onSelectNode={vi.fn()} />);

    const canvas = screen.getByTestId('canvas');
    fireEvent.dragEnter(screen.getByTestId('react-flow-pane'), {
      dataTransfer: {
        types: ['application/runflux-plugin-id'],
      },
    });

    expect(canvas).toHaveAttribute('data-drag-active', 'true');
    expect(screen.getByText(/solte para adicionar ao fluxo/i)).toBeInTheDocument();
  });

  it('shows the dragged plugin itself in the canvas preview', () => {
    render(<Canvas catalog={catalog} onSelectNode={vi.fn()} />);

    window.dispatchEvent(new CustomEvent('runflux:palette-drag-start', {
      detail: { id: 'action-http', name: 'HTTP Request', category: 'action', version: '1.2.3' },
    }));
    fireEvent.dragEnter(screen.getByTestId('react-flow-pane'), {
      dataTransfer: { types: ['application/runflux-plugin-id'] },
    });

    expect(screen.getByTestId('dragged-node-preview')).toHaveTextContent('HTTP Request');
    expect(screen.getByTestId('dragged-node-preview')).toHaveTextContent('Ação');
  });

  it('adds the dragged plugin from preview state when custom DataTransfer data is unavailable', async () => {
    render(<Canvas catalog={catalog} onSelectNode={vi.fn()} />);

    window.dispatchEvent(new CustomEvent('runflux:palette-drag-start', {
      detail: { id: 'action-http', name: 'HTTP Request', category: 'action', version: '1.2.3' },
    }));
    const pane = screen.getByTestId('react-flow-pane');
    fireEvent.dragEnter(pane, {
      dataTransfer: { types: ['application/runflux-plugin-id'] },
    });
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperties(dropEvent, {
      clientX: { value: 240 },
      clientY: { value: 180 },
      dataTransfer: { value: { getData: () => '' } },
    });
    fireEvent(pane, dropEvent);

    await vi.waitFor(() => expect(useWorkflowStore.getState().workflow.nodes).toHaveLength(1));
    expect(pane).toHaveAttribute('data-node-count', '1');
    expect(useWorkflowStore.getState().workflow.nodes[0]).toMatchObject({
      pluginId: 'action-http',
      pluginVersion: '1.2.3',
      position: { x: 240, y: 180 },
    });
  });

  it('adds a plugin dropped onto the main canvas container using application/json payload', async () => {
    render(<Canvas catalog={catalog} onSelectNode={vi.fn()} />);

    const canvas = screen.getByTestId('canvas');
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperties(dropEvent, {
      clientX: { value: 300 },
      clientY: { value: 200 },
      dataTransfer: {
        value: {
          getData: (type: string) => {
            if (type === 'application/json') {
              return JSON.stringify({ id: 'action-json', name: 'JSON Action', category: 'action', version: '2.0.0' });
            }
            return '';
          },
        },
      },
    });
    fireEvent(canvas, dropEvent);

    await vi.waitFor(() => expect(useWorkflowStore.getState().workflow.nodes).toHaveLength(1));
    expect(useWorkflowStore.getState().workflow.nodes[0]).toMatchObject({
      pluginId: 'action-json',
      pluginVersion: '2.0.0',
      position: { x: 300, y: 200 },
    });
  });

  it('nests a dropped node into a subflow when dropped within subflow boundaries', async () => {
    useWorkflowStore.setState({
      workflow: {
        id: 'wf-subflow',
        name: 'Subflow Test',
        nodes: [
          {
            id: 'subflow-1',
            pluginId: 'runflux.subflow',
            pluginVersion: '1.0.0',
            parameters: {},
            position: { x: 100, y: 100 },
            appearance: { shape: 'subflow', width: 500, height: 300 },
          },
        ],
        connections: [],
      },
      selectedNodeId: undefined,
    });

    render(<Canvas catalog={catalog} onSelectNode={vi.fn()} />);

    const canvas = screen.getByTestId('canvas');
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperties(dropEvent, {
      clientX: { value: 250 },
      clientY: { value: 220 },
      dataTransfer: {
        value: {
          getData: (type: string) => (type === 'application/runflux-plugin-id' ? 'trigger-http' : ''),
        },
      },
    });
    fireEvent(canvas, dropEvent);

    await vi.waitFor(() => expect(useWorkflowStore.getState().workflow.nodes).toHaveLength(2));
    const childNode = useWorkflowStore.getState().workflow.nodes.find((n) => n.pluginId === 'trigger-http');
    expect(childNode).toBeDefined();
    expect(childNode?.parentId).toBe('subflow-1');
    expect(childNode?.position).toEqual({ x: 150, y: 120 });
  });
});
