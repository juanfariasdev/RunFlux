import { useCallback, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  ReactFlow,
  useReactFlow,
  type Connection,
  type OnNodeDrag,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { PluginManifest } from '@runflux/plugin-system/types';
import type { PluginCatalogAdapter } from '../adapters/plugin-catalog-adapter';
import { fromReactFlowEdge, toReactFlowEdge, toReactFlowNode, type FlowNode } from '../adapters/react-flow-adapter';
import { isConnectionCompatible } from '../domain/connection-compatibility';
import { useWorkflowStore } from '../store/workflow-store';
import { WorkflowNodeView } from './WorkflowNodeView';

const nodeTypes = { workflowNode: WorkflowNodeView };

export interface CanvasProps {
  catalog: PluginCatalogAdapter;
  onSelectNode: (nodeId: string | undefined) => void;
}

export function Canvas({ catalog, onSelectNode }: CanvasProps) {
  const workflow = useWorkflowStore((s) => s.workflow);
  const addNode = useWorkflowStore((s) => s.addNode);
  const addConnection = useWorkflowStore((s) => s.addConnection);
  const moveNode = useWorkflowStore((s) => s.moveNode);
  const [manifests, setManifests] = useState<Record<string, PluginManifest>>({});
  const [rejectionMessage, setRejectionMessage] = useState<string | undefined>();
  const { screenToFlowPosition } = useReactFlow();

  // Resolve every plugin manifest referenced by the current workflow (used for
  // rendering labels and for the RF-05 compatibility check).
  const manifestFor = useCallback(
    (pluginId: string) => manifests[pluginId],
    [manifests],
  );

  const nodes: FlowNode[] = useMemo(
    () =>
      workflow.nodes.map((node) =>
        toReactFlowNode(node, manifestFor(node.pluginId), { status: manifestFor(node.pluginId) ? 'ok' : 'missing' }),
      ),
    [workflow.nodes, manifestFor],
  );
  const edges = useMemo(() => workflow.connections.map(toReactFlowEdge), [workflow.connections]);

  const loadManifest = useCallback(
    async (pluginId: string) => {
      if (manifests[pluginId]) return manifests[pluginId];
      const grouped = await catalog.listPlugins();
      const found = Object.values(grouped)
        .flat()
        .find((m) => m.id === pluginId);
      if (found) setManifests((prev) => ({ ...prev, [pluginId]: found }));
      return found;
    },
    [catalog, manifests],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const sourceNode = workflow.nodes.find((n) => n.id === connection.source);
      const targetNode = workflow.nodes.find((n) => n.id === connection.target);
      const compatible = isConnectionCompatible(
        sourceNode && manifestFor(sourceNode.pluginId),
        targetNode && manifestFor(targetNode.pluginId),
      );

      if (!compatible) {
        setRejectionMessage(
          'Incompatible connection: triggers cannot receive an incoming connection, and outputs cannot send to a further node.',
        );
        return;
      }

      const accepted = addConnection(fromReactFlowEdge({ id: 'tmp', ...connection } as never));
      if (!accepted) {
        setRejectionMessage('Rejected: this connection would create a cycle.');
      } else {
        setRejectionMessage(undefined);
      }
    },
    [workflow.nodes, manifestFor, addConnection],
  );

  const onNodeDragStop: OnNodeDrag<FlowNode> = useCallback(
    (_event, node) => {
      moveNode(node.id, node.position);
    },
    [moveNode],
  );

  const onDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      const pluginId = event.dataTransfer.getData('application/runflux-plugin-id');
      if (!pluginId) return;

      const manifest = await loadManifest(pluginId);
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });

      addNode({
        id: crypto.randomUUID(),
        pluginId,
        pluginVersion: manifest?.version ?? '0.0.0',
        parameters: {},
        position,
      });
    },
    [addNode, loadManifest, screenToFlowPosition],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  return (
    <div className="relative h-full flex-1" onDrop={onDrop} onDragOver={onDragOver} data-testid="canvas">
      {workflow.nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="text-sm text-slate-400">Drag a trigger here to get started</p>
        </div>
      )}
      {rejectionMessage && (
        <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-md bg-red-50 px-3 py-1.5 text-xs text-red-700 shadow" role="alert">
          {rejectionMessage}
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={(_event, node) => onSelectNode(node.id)}
        onPaneClick={() => onSelectNode(undefined)}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
