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
