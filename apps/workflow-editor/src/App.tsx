import { useCallback, useEffect, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import type { PluginManifest } from '@runflux/plugin-system/types';
import { HttpPluginCatalogAdapter } from './adapters/plugin-catalog-adapter';
import { HttpValidationRuntimeAdapter } from './adapters/validation-runtime-adapter';
import { InMemoryWorkflowPersistenceAdapter } from './adapters/workflow-persistence-adapter';
import { connectionId } from './adapters/react-flow-adapter';
import { Canvas } from './components/Canvas';
import { EdgeConfigPanel } from './components/EdgeConfigPanel';
import { NodeConfigPanel } from './components/NodeConfigPanel';
import { Palette } from './components/Palette';
import { Toolbar } from './components/Toolbar';
import { useWorkflowStore } from './store/workflow-store';

// Browser-safe: fetches the catalog served by vite-plugin-plugin-catalog.ts
// (dev middleware / static build asset) instead of running discovery here.
const catalog = new HttpPluginCatalogAdapter();
const persistence = new InMemoryWorkflowPersistenceAdapter();
const validation = new HttpValidationRuntimeAdapter();

export function App() {
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | undefined>();
  const workflow = useWorkflowStore((s) => s.workflow);
  const nodes = workflow.nodes;
  const connections = workflow.connections;
  const nodeResults = useWorkflowStore((s) => s.nodeResults);
  const setNodeResult = useWorkflowStore((s) => s.setNodeResult);
  const updateNodeParameters = useWorkflowStore((s) => s.updateNodeParameters);
  const updateNodeAppearance = useWorkflowStore((s) => s.updateNodeAppearance);
  const updateConnection = useWorkflowStore((s) => s.updateConnection);
  const removeNode = useWorkflowStore((s) => s.removeNode);
  const removeConnection = useWorkflowStore((s) => s.removeConnection);
  const [manifestsById, setManifestsById] = useState<Map<string, PluginManifest>>(new Map());
  const [testingNodeId, setTestingNodeId] = useState<string | undefined>();

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const selectedConnection = connections.find((connection) => connectionId(connection) === selectedEdgeId);

  // RF-04: test a single node in isolation, reusing cached upstream results
  // the validation runtime already knows about (RN-03/RN-06).
  const handleTestNode = useCallback(async (nodeId: string) => {
    setTestingNodeId(nodeId);
    try {
      const result = await validation.runNode(workflow, nodeId, { mode: 'sandbox' });
      setNodeResult(result);
    } finally {
      setTestingNodeId(undefined);
    }
  }, [workflow, setNodeResult]);

  useEffect(() => {
    let cancelled = false;
    catalog.listPlugins().then((grouped) => {
      if (!cancelled) setManifestsById(new Map(Object.values(grouped).flat().map((manifest) => [manifest.id, manifest])));
    });
    return () => { cancelled = true; };
  }, []);

  const selectedManifest = selectedNode ? manifestsById.get(selectedNode.pluginId) : undefined;

  return (
    <div className="flex h-full min-w-[900px] flex-col overflow-hidden bg-slate-50 text-slate-900">
      <Toolbar catalog={catalog} persistence={persistence} validation={validation} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Palette catalog={catalog} />
        <ReactFlowProvider>
          <Canvas catalog={catalog} onSelectNode={setSelectedNodeId} onSelectEdge={setSelectedEdgeId} />
        </ReactFlowProvider>
        {selectedNode && (
          <NodeConfigPanel
            key={selectedNode.id}
            manifest={selectedManifest}
            values={selectedNode.parameters}
            appearance={selectedNode.appearance}
            onChange={(values) => updateNodeParameters(selectedNode.id, values)}
            onAppearanceChange={(appearance) => updateNodeAppearance(selectedNode.id, appearance)}
            onDelete={() => {
              removeNode(selectedNode.id);
              setSelectedNodeId(undefined);
            }}
            onClose={() => setSelectedNodeId(undefined)}
            onTest={() => handleTestNode(selectedNode.id)}
            isTesting={testingNodeId === selectedNode.id}
            testResult={nodeResults[selectedNode.id]}
          />
        )}
        {selectedConnection && (
          <EdgeConfigPanel
            connection={selectedConnection}
            onChange={(appearance) => updateConnection(
              selectedConnection.sourceNodeId,
              selectedConnection.sourceOutput,
              selectedConnection.targetNodeId,
              selectedConnection.targetInput,
              appearance,
            )}
            onDelete={() => {
              removeConnection(selectedConnection.sourceNodeId, selectedConnection.sourceOutput, selectedConnection.targetNodeId, selectedConnection.targetInput);
              setSelectedEdgeId(undefined);
            }}
            onClose={() => setSelectedEdgeId(undefined)}
          />
        )}
      </div>
    </div>
  );
}
