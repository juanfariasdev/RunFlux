import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginCatalogAdapter } from '../../adapters/plugin-catalog-adapter';
import { useWorkflowStore } from '../../store/workflow-store';
import { Canvas } from '../Canvas';

const reactFlowMocks = vi.hoisted(() => ({
  fitView: vi.fn(),
  screenToFlowPosition: vi.fn(({ x, y }: { x: number; y: number }) => ({ x, y })),
  zoom: 1,
}));

vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual<typeof import('@xyflow/react')>('@xyflow/react');

  return {
    ...actual,
    ReactFlow: ({ children, onDrop, nodes = [], fitView: shouldFitView, selectionOnDrag, panOnDrag, selectionKeyCode, multiSelectionKeyCode }: React.HTMLAttributes<HTMLDivElement> & { nodes?: unknown[]; fitView?: boolean; selectionOnDrag?: boolean; panOnDrag?: boolean; selectionKeyCode?: string | string[] | null; multiSelectionKeyCode?: string | string[] | null }) => (
      <div
        data-testid="react-flow-pane"
        data-node-count={nodes.length}
        data-fit-view={shouldFitView ? 'true' : 'false'}
        data-selection-on-drag={selectionOnDrag ? 'true' : 'false'}
        data-pan-on-drag={panOnDrag ? 'true' : 'false'}
        data-selection-key={Array.isArray(selectionKeyCode) ? selectionKeyCode.join(',') : selectionKeyCode ?? ''}
        data-multi-selection-key={Array.isArray(multiSelectionKeyCode) ? multiSelectionKeyCode.join(',') : multiSelectionKeyCode ?? ''}
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
      screenToFlowPosition: reactFlowMocks.screenToFlowPosition,
      fitView: reactFlowMocks.fitView,
    }),
    useViewport: () => ({ x: 0, y: 0, zoom: reactFlowMocks.zoom }),
  };
});

const catalog: PluginCatalogAdapter = {
  listPlugins: async () => ({}),
  checkReference: async () => ({ status: 'missing' }),
};

beforeEach(() => {
  reactFlowMocks.fitView.mockReset();
  reactFlowMocks.zoom = 1;
  reactFlowMocks.screenToFlowPosition.mockReset();
  reactFlowMocks.screenToFlowPosition.mockImplementation(({ x, y }) => ({ x, y }));
  useWorkflowStore.setState({
    workflow: { id: 'wf-test', name: 'Test', nodes: [], connections: [] },
    selectedNodeId: undefined,
  });
});

describe('Canvas external drag feedback', () => {
  it('offers an explicit multi-select mode that switches drag from panning to selection', () => {
    render(<Canvas catalog={catalog} onSelectNode={vi.fn()} />);

    const pane = screen.getByTestId('react-flow-pane');
    const button = screen.getByRole('button', { name: /selecionar vários/i });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(pane).toHaveAttribute('data-selection-on-drag', 'false');
    expect(pane).toHaveAttribute('data-pan-on-drag', 'true');

    fireEvent.click(button);

    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(pane).toHaveAttribute('data-selection-on-drag', 'true');
    expect(pane).toHaveAttribute('data-pan-on-drag', 'false');
  });

  it('uses Ctrl/Command for both additive clicks and drag-box multi-selection', () => {
    render(<Canvas catalog={catalog} onSelectNode={vi.fn()} />);

    const pane = screen.getByTestId('react-flow-pane');
    expect(pane).toHaveAttribute('data-selection-key', 'Meta,Control');
    expect(pane).toHaveAttribute('data-multi-selection-key', 'Meta,Control');
  });

  it('visually marks the canvas as an active drop target while a palette item is over it', () => {
    render(<Canvas catalog={catalog} onSelectNode={vi.fn()} />);

    const canvas = screen.getByTestId('canvas');
    fireEvent.dragEnter(screen.getByTestId('react-flow-pane'), {
      dataTransfer: {
        types: ['application/runflux-plugin-id'],
      },
    });

    expect(canvas).toHaveAttribute('data-drag-active', 'true');
    expect(screen.getByText(/drop to add to the workflow/i)).toBeInTheDocument();
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
    expect(screen.getByTestId('dragged-node-preview')).toHaveTextContent('Action');
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
      position: { x: 130, y: 128 },
    });
  });

  it('keeps the current viewport when a node is dropped', async () => {
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
      clientX: { value: 320 },
      clientY: { value: 240 },
      dataTransfer: { value: { getData: () => '' } },
    });
    fireEvent(pane, dropEvent);

    await vi.waitFor(() => expect(useWorkflowStore.getState().workflow.nodes).toHaveLength(1));
    expect(reactFlowMocks.fitView).not.toHaveBeenCalled();
    expect(pane).toHaveAttribute('data-fit-view', 'false');
  });

  it('matches the drag preview and dropped node to a zoomed viewport', async () => {
    reactFlowMocks.zoom = 0.5;
    reactFlowMocks.screenToFlowPosition.mockImplementation(({ x, y }) => ({ x: x / 0.5, y: y / 0.5 }));
    render(<Canvas catalog={catalog} onSelectNode={vi.fn()} />);

    window.dispatchEvent(new CustomEvent('runflux:palette-drag-start', {
      detail: { id: 'action-http', name: 'HTTP Request', category: 'action', version: '1.2.3' },
    }));
    const pane = screen.getByTestId('react-flow-pane');
    fireEvent.dragEnter(pane, { dataTransfer: { types: ['application/runflux-plugin-id'] } });
    const dragOverEvent = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperties(dragOverEvent, {
      clientX: { value: 300 },
      clientY: { value: 200 },
      dataTransfer: { value: { types: ['application/runflux-plugin-id'], dropEffect: 'none' } },
    });
    fireEvent(screen.getByTestId('canvas'), dragOverEvent);

    const preview = screen.getByTestId('dragged-node-preview');
    expect(preview).toHaveStyle({
      left: '300px',
      top: '200px',
      transform: 'translate(-50%, -50%) scale(0.5)',
    });

    const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperties(dropEvent, {
      clientX: { value: 300 },
      clientY: { value: 200 },
      dataTransfer: { value: { getData: () => '' } },
    });
    fireEvent(pane, dropEvent);

    await vi.waitFor(() => expect(useWorkflowStore.getState().workflow.nodes).toHaveLength(1));
    expect(useWorkflowStore.getState().workflow.nodes[0].position).toEqual({ x: 490, y: 348 });
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
      position: { x: 190, y: 148 },
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
    expect(childNode?.position).toEqual({ x: 40, y: 68 });
  });
});
