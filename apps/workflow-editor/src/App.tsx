import { useEffect, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import type { PluginManifest } from '@runflux/plugin-system/types';
import { HttpPluginCatalogAdapter } from './adapters/plugin-catalog-adapter';
import { NoopValidationRuntimeAdapter } from './adapters/validation-runtime-adapter';
import { InMemoryWorkflowPersistenceAdapter } from './adapters/workflow-persistence-adapter';
import { Canvas } from './components/Canvas';
import { NodeConfigPanel } from './components/NodeConfigPanel';
import { Palette } from './components/Palette';
import { Toolbar } from './components/Toolbar';
import { useWorkflowStore } from './store/workflow-store';

// Browser-safe: fetches the catalog served by vite-plugin-plugin-catalog.ts
// (dev middleware / static build asset) instead of running discovery here.
const catalog = new HttpPluginCatalogAdapter();
const persistence = new InMemoryWorkflowPersistenceAdapter();
const validation = new NoopValidationRuntimeAdapter();

export function App() {
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
  const nodes = useWorkflowStore((s) => s.workflow.nodes);
  const updateNodeParameters = useWorkflowStore((s) => s.updateNodeParameters);
  const [manifestsById, setManifestsById] = useState<Map<string, PluginManifest>>(new Map());

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  useEffect(() => {
    if (!selectedNode || manifestsById.has(selectedNode.pluginId)) return;
    catalog.listPlugins().then((grouped) => {
      const map = new Map(Object.values(grouped).flat().map((m) => [m.id, m]));
      setManifestsById(map);
    });
  }, [selectedNode, manifestsById]);

  const selectedManifest = selectedNode ? manifestsById.get(selectedNode.pluginId) : undefined;

  return (
    <div className="flex h-full flex-col">
      <Toolbar catalog={catalog} persistence={persistence} validation={validation} />
      <div className="flex flex-1 overflow-hidden">
        <Palette catalog={catalog} />
        <ReactFlowProvider>
          <Canvas catalog={catalog} onSelectNode={setSelectedNodeId} />
        </ReactFlowProvider>
        {selectedNode && selectedManifest && (
          <NodeConfigPanel
            manifest={selectedManifest}
            values={selectedNode.parameters}
            onChange={(values) => updateNodeParameters(selectedNode.id, values)}
            onClose={() => setSelectedNodeId(undefined)}
          />
        )}
      </div>
    </div>
  );
}
