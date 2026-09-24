import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReactFlowProvider } from '@xyflow/react';
import { Canvas } from '../Canvas';
import { useWorkflowStore } from '../../store/workflow-store';
import type { PluginCatalogAdapter } from '../../adapters/plugin-catalog-adapter';
import type { WorkflowConnection } from '@runflux/workflow-model/types';

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

const catalogWithHttpOutput: PluginCatalogAdapter = {
  ...catalog,
  listPlugins: async () => ({
    output: [{
      id: 'http-output',
      name: 'HTTP Request',
      category: 'output',
      version: '1.0.0',
      parameters: [],
      supportedPlatforms: ['local'],
    }],
  }),
};

describe('Canvas with REAL React Flow', () => {
  it('opens a context menu on right click and acts on the clicked node', async () => {
    useWorkflowStore.setState({
      workflow: {
        id: 'wf-context-menu',
        name: 'Context menu',
        nodes: [
          { id: 'a', pluginId: 'trigger-manual-example', pluginVersion: '1.0.0', parameters: {}, position: { x: 100, y: 100 } },
          { id: 'b', pluginId: 'trigger-manual-example', pluginVersion: '1.0.0', parameters: {}, position: { x: 400, y: 100 } },
        ],
        connections: [],
      },
      selectedNodeId: undefined,
      nodeResults: {},
      historyPast: [],
      historyFuture: [],
      historyTransactionBase: undefined,
    });

    const { container } = render(
      <div style={{ width: 1000, height: 800 }}>
        <ReactFlowProvider>
          <Canvas catalog={catalog} onSelectNode={() => {}} />
        </ReactFlowProvider>
      </div>
    );

    const nodeB = await waitFor(() => container.querySelector('.react-flow__node[data-id="b"]') as HTMLElement);
    fireEvent.contextMenu(nodeB, { clientX: 500, clientY: 200 });

    const menu = await screen.findByRole('menu', { name: /menu de contexto/i });
    expect(menu).toBeInTheDocument();
    expect(nodeB).toHaveClass('selected');
    expect(screen.getByRole('menuitem', { name: /copiar/i })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: /colar/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('menuitem', { name: /^Excluir/i }));
    await waitFor(() => expect(useWorkflowStore.getState().workflow.nodes.map((node) => node.id)).toEqual(['a']));
    expect(screen.queryByRole('menu', { name: /menu de contexto/i })).not.toBeInTheDocument();
  });

  it('keeps a multi-selection when right-clicking one of its nodes', async () => {
    useWorkflowStore.setState({
      workflow: {
        id: 'wf-context-multi',
        name: 'Context multi',
        nodes: [
          { id: 'a', pluginId: 'trigger-manual-example', pluginVersion: '1.0.0', parameters: {}, position: { x: 100, y: 100 } },
          { id: 'b', pluginId: 'trigger-manual-example', pluginVersion: '1.0.0', parameters: {}, position: { x: 400, y: 100 } },
        ],
        connections: [],
      },
      selectedNodeId: undefined,
      nodeResults: {},
      historyPast: [],
      historyFuture: [],
      historyTransactionBase: undefined,
    });

    const { container } = render(
      <div style={{ width: 1000, height: 800 }}>
        <ReactFlowProvider>
          <Canvas catalog={catalog} onSelectNode={() => {}} />
        </ReactFlowProvider>
      </div>
    );

    const nodeA = await waitFor(() => container.querySelector('.react-flow__node[data-id="a"]') as HTMLElement);
    const nodeB = container.querySelector('.react-flow__node[data-id="b"]') as HTMLElement;
    fireEvent.click(nodeA);
    fireEvent.keyDown(window, { key: 'Control', code: 'ControlLeft', ctrlKey: true });
    fireEvent.click(nodeB, { ctrlKey: true });
    fireEvent.keyUp(window, { key: 'Control', code: 'ControlLeft' });
    await waitFor(() => expect(screen.getByTestId('multi-selection-count')).toHaveTextContent('2 selecionados'));

    fireEvent.contextMenu(nodeA, { clientX: 300, clientY: 180 });
    expect(await screen.findByRole('menuitem', { name: /Copiar 2 itens/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Excluir 2 itens/i })).toBeInTheDocument();
  });

  it('multi-selects nodes and copies/pastes their internal connections, then undoes the paste', async () => {
    useWorkflowStore.setState({
      workflow: {
        id: 'wf-copy-paste',
        name: 'Copy paste',
        nodes: [
          { id: 'a', pluginId: 'trigger-manual-example', pluginVersion: '1.0.0', parameters: { label: 'A' }, position: { x: 100, y: 100 } },
          { id: 'b', pluginId: 'trigger-manual-example', pluginVersion: '1.0.0', parameters: { label: 'B' }, position: { x: 400, y: 100 } },
        ],
        connections: [{ sourceNodeId: 'a', sourceOutput: 'main', targetNodeId: 'b', targetInput: 'main' }],
      },
      selectedNodeId: undefined,
      nodeResults: {},
      historyPast: [],
      historyFuture: [],
      historyTransactionBase: undefined,
    });

    const { container } = render(
      <div style={{ width: 1000, height: 800 }}>
        <ReactFlowProvider>
          <Canvas catalog={catalog} onSelectNode={() => {}} />
        </ReactFlowProvider>
      </div>
    );

    const nodeA = await waitFor(() => container.querySelector('.react-flow__node[data-id="a"]') as HTMLElement);
    const nodeB = container.querySelector('.react-flow__node[data-id="b"]') as HTMLElement;
    fireEvent.click(nodeA);
    fireEvent.keyDown(window, { key: 'Control', code: 'ControlLeft', ctrlKey: true });
    fireEvent.click(nodeB, { ctrlKey: true });
    fireEvent.keyUp(window, { key: 'Control', code: 'ControlLeft' });

    await waitFor(() => {
      expect(nodeA).toHaveClass('selected');
      expect(nodeB).toHaveClass('selected');
    });

    fireEvent.keyDown(window, { key: 'c', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true });

    await waitFor(() => {
      const workflow = useWorkflowStore.getState().workflow;
      expect(workflow.nodes).toHaveLength(4);
      expect(workflow.connections).toHaveLength(2);
      const copied = workflow.nodes.filter((node) => node.id !== 'a' && node.id !== 'b');
      expect(copied).toHaveLength(2);
      expect(copied.map((node) => node.position)).toEqual(expect.arrayContaining([{ x: 132, y: 132 }, { x: 432, y: 132 }]));
      expect(workflow.connections.some((connection) => copied.some((node) => node.id === connection.sourceNodeId) && copied.some((node) => node.id === connection.targetNodeId))).toBe(true);
    });

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => {
      expect(useWorkflowStore.getState().workflow.nodes.map((node) => node.id)).toEqual(['a', 'b']);
      expect(useWorkflowStore.getState().workflow.connections).toHaveLength(1);
    });
  });

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

  it('moves node handles to the top and bottom for vertical, then horizontal sides for grid', async () => {
    const connection: WorkflowConnection = {
      sourceNodeId: 'trigger', sourceOutput: 'main', targetNodeId: 'action', targetInput: 'main',
    };
    useWorkflowStore.setState({
      workflow: {
        id: 'wf-layout',
        name: 'Layout',
        nodes: [
          { id: 'trigger', pluginId: 'trigger-manual-example', pluginVersion: '1.0.0', parameters: {}, position: { x: 100, y: 100 } },
          { id: 'action', pluginId: 'missing-action', pluginVersion: '1.0.0', parameters: {}, position: { x: 400, y: 100 } },
        ],
        connections: [connection],
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

    fireEvent.click(screen.getByRole('button', { name: 'Vertical' }));
    await waitFor(() => {
      expect(container.querySelector('.react-flow__handle-bottom')).toBeInTheDocument();
      expect(container.querySelector('.react-flow__handle-top')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Grid' }));
    await waitFor(() => {
      expect(container.querySelector('.react-flow__handle-right')).toBeInTheDocument();
      expect(container.querySelector('.react-flow__handle-left')).toBeInTheDocument();
    });
  });

  it('keeps the default main handle available on output-category nodes in either layout', async () => {
    useWorkflowStore.setState({
      workflow: {
        id: 'wf-output-edge',
        name: 'Output edge',
        nodes: [
          { id: 'probe-get', pluginId: 'http-output', pluginVersion: '1.0.0', parameters: {}, position: { x: 100, y: 100 } },
          { id: 'health-summary', pluginId: 'code-javascript', pluginVersion: '1.0.0', parameters: {}, position: { x: 400, y: 100 } },
        ],
        connections: [{
          sourceNodeId: 'probe-get', sourceOutput: 'main', targetNodeId: 'health-summary', targetInput: 'main',
        }],
      },
      selectedNodeId: undefined,
    });

    const { container } = render(
      <div style={{ width: 1000, height: 800 }}>
        <ReactFlowProvider>
          <Canvas catalog={catalogWithHttpOutput} onSelectNode={() => {}} />
        </ReactFlowProvider>
      </div>
    );

    const sourceSelector = '.react-flow__node[data-id="probe-get"] .react-flow__handle.source[data-handleid="main"]';
    await waitFor(() => expect(container.querySelector(sourceSelector)).toHaveAttribute('data-handlepos', 'right'));

    fireEvent.click(screen.getByRole('button', { name: 'Vertical' }));
    await waitFor(() => expect(container.querySelector(sourceSelector)).toHaveAttribute('data-handlepos', 'bottom'));
  });

  it('keeps edge endpoints centered on connection dots after switching layouts', async () => {
    useWorkflowStore.setState({
      workflow: {
        id: 'wf-edge-alignment',
        name: 'Edge alignment',
        nodes: [
          { id: 'probe-get', pluginId: 'http-output', pluginVersion: '1.0.0', parameters: {}, position: { x: 100, y: 100 } },
          { id: 'health-summary', pluginId: 'code-javascript', pluginVersion: '1.0.0', parameters: {}, position: { x: 400, y: 100 } },
        ],
        connections: [{ sourceNodeId: 'probe-get', sourceOutput: 'main', targetNodeId: 'health-summary', targetInput: 'main' }],
      },
      selectedNodeId: undefined,
    });

    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const widthOf = (element: HTMLElement) => element.style.width === '0px' ? 0 : Number.parseFloat(element.style.width) || (element.classList.contains('react-flow__handle') ? 12 : 220);
      const heightOf = (element: HTMLElement) => element.style.height === '0px' ? 0 : Number.parseFloat(element.style.height) || (element.classList.contains('react-flow__handle') ? 12 : 104);

      if (this.classList.contains('react-flow__node')) {
        const width = widthOf(this);
        const height = heightOf(this);
        return new DOMRect(0, 0, width, height);
      }

      if (this.classList.contains('react-flow__handle')) {
        const node = this.closest<HTMLElement>('.react-flow__node');
        if (node) {
          const nodeWidth = widthOf(node);
          const nodeHeight = heightOf(node);
          const width = widthOf(this);
          const height = heightOf(this);
          const position = this.getAttribute('data-handlepos');
          const left = position === 'right' ? nodeWidth : position === 'left' ? -width : (nodeWidth - width) / 2;
          const top = position === 'bottom' ? nodeHeight : position === 'top' ? -height : (nodeHeight - height) / 2;
          return new DOMRect(left, top, width, height);
        }
      }

      const handle = this.closest<HTMLElement>('.react-flow__handle');
      if (handle && this.hasAttribute('data-testid') && this.getAttribute('data-testid') === 'connection-dot') {
        const anchor = handle.getBoundingClientRect();
        return new DOMRect(anchor.left - 6, anchor.top - 6, 12, 12);
      }

      return originalRect.call(this);
    });
    const originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return this.classList.contains('react-flow__node') ? (Number.parseFloat(this.style.width) || 220) : (this.classList.contains('react-flow__handle') && this.style.width === '0px' ? 0 : this.classList.contains('react-flow__handle') ? 12 : 0); } });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return this.classList.contains('react-flow__node') ? (Number.parseFloat(this.style.height) || 104) : (this.classList.contains('react-flow__handle') && this.style.height === '0px' ? 0 : this.classList.contains('react-flow__handle') ? 12 : 0); } });

    try {
      const { container } = render(
        <div style={{ width: 1000, height: 800 }}>
          <ReactFlowProvider>
            <Canvas catalog={catalogWithHttpOutput} onSelectNode={() => {}} />
          </ReactFlowProvider>
        </div>
      );

      const sourceSelector = '.react-flow__node[data-id="probe-get"] .react-flow__handle.source[data-handleid="main"]';
      const targetSelector = '.react-flow__node[data-id="health-summary"] .react-flow__handle.target[data-handleid="main"]';
      const assertSourceAlignment = async (layout: 'horizontal' | 'vertical') => {
        const sourceHandle = container.querySelector<HTMLElement>(sourceSelector);
        const targetHandle = container.querySelector<HTMLElement>(targetSelector);
        expect(sourceHandle).toHaveAttribute('data-handlepos', layout === 'vertical' ? 'bottom' : 'right');
        expect(targetHandle).toHaveAttribute('data-handlepos', layout === 'vertical' ? 'top' : 'left');
        await waitFor(() => {
          const edgePath = container.querySelector<SVGPathElement>('.react-flow__edge-path');
          expect(edgePath).toBeInTheDocument();
          const pathCoordinates = [...edgePath!.getAttribute('d')!.matchAll(/-?[\d.]+/g)].map(([coordinate]) => Number(coordinate));
          expect(pathCoordinates.length).toBeGreaterThanOrEqual(4);

          const endpoint = (handle: HTMLElement) => {
            const node = handle.closest<HTMLElement>('.react-flow__node')!;
            const translate = node.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
            expect(translate).not.toBeNull();
            const dot = handle.querySelector<HTMLElement>('[data-testid="connection-dot"]') ?? handle;
            const dotBounds = dot.getBoundingClientRect();
            return [
              Number(translate![1]) + dotBounds.left + dotBounds.width / 2,
              Number(translate![2]) + dotBounds.top + dotBounds.height / 2,
            ];
          };

          const [sourceX, sourceY] = endpoint(sourceHandle!);
          const [targetX, targetY] = endpoint(targetHandle!);
          expect(pathCoordinates[0]).toBeCloseTo(sourceX, 4);
          expect(pathCoordinates[1]).toBeCloseTo(sourceY, 4);
          expect(pathCoordinates.at(-2)).toBeCloseTo(targetX, 4);
          expect(pathCoordinates.at(-1)).toBeCloseTo(targetY, 4);
        });
      };

      await assertSourceAlignment('horizontal');
      fireEvent.click(screen.getByRole('button', { name: 'Vertical' }));
      await assertSourceAlignment('vertical');
    } finally {
      rectSpy.mockRestore();
      if (originalOffsetWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalOffsetWidth);
      else delete (HTMLElement.prototype as { offsetWidth?: number }).offsetWidth;
      if (originalOffsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight);
      else delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
    }
  });
});
