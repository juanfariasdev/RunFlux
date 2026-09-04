import { useCallback, useEffect, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import type { PluginManifest } from '@runflux/plugin-system/types';
import { HttpPluginCatalogAdapter } from './adapters/plugin-catalog-adapter';
import { HttpValidationRuntimeAdapter } from './adapters/validation-runtime-adapter';
import { HttpProjectApiAdapter } from './adapters/project-api-adapter';
import { connectionId } from './adapters/react-flow-adapter';
import { Canvas } from './components/Canvas';
import { EdgeConfigPanel } from './components/EdgeConfigPanel';
import { NodeConfigPanel } from './components/NodeConfigPanel';
import { Palette } from './components/Palette';
import { Toolbar } from './components/Toolbar';
import { useWorkflowStore } from './store/workflow-store';
import { ProjectProvider, useProject } from './context/ProjectContext';

const catalog = new HttpPluginCatalogAdapter();
const projectAdapter = new HttpProjectApiAdapter();
const validation = new HttpValidationRuntimeAdapter();

function WorkflowEditorContent() {
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | undefined>();
  const workflow = useWorkflowStore((s) => s.workflow);
  const nodes = workflow.nodes;
  const connections = workflow.connections;
  const nodeResults = useWorkflowStore((s) => s.nodeResults);
  const setNodeResult = useWorkflowStore((s) => s.setNodeResult);
  const clearNodeResult = useWorkflowStore((s) => s.clearNodeResult);
  const updateNodeParameters = useWorkflowStore((s) => s.updateNodeParameters);
  const updateNodeAppearance = useWorkflowStore((s) => s.updateNodeAppearance);
  const updateConnection = useWorkflowStore((s) => s.updateConnection);
  const removeNode = useWorkflowStore((s) => s.removeNode);
  const removeConnection = useWorkflowStore((s) => s.removeConnection);
  const [manifestsById, setManifestsById] = useState<Map<string, PluginManifest>>(new Map());
  // Node ids currently "being tested" — a single node under "Test this node", or every
  // Webhook Trigger in the workflow while the toolbar's whole-workflow "Test" is waiting
  // on one. Each shows the same waiting/spinning badge on its canvas box.
  const [testingNodeIds, setTestingNodeIds] = useState<Set<string>>(new Set());

  const { isDirty } = useProject();

  // T021: Previne fechamento acidental da aba se houver alterações não salvas (RF-11)
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const selectedConnection = connections.find((connection) => connectionId(connection) === selectedEdgeId);

  // RF-04: test a single node in isolation, reusing cached upstream results
  const handleCancelTest = useCallback(async () => {
    try {
      await fetch('/runflux-webhook-cancel', { method: 'POST' }).catch(() => {});
    } finally {
      setTestingNodeIds(new Set());
    }
  }, []);

  const handleTestNode = useCallback(async (nodeId: string) => {
    // Clear whatever the last test left showing — otherwise a stale success/output
    // stays visible the whole time this new test is running (e.g. a webhook wait).
    clearNodeResult(nodeId);
    setTestingNodeIds(new Set([nodeId]));
    try {
      const result = await validation.runNode(workflow, nodeId, { mode: 'sandbox' });
      setNodeResult(result);
    } finally {
      setTestingNodeIds(new Set());
    }
  }, [workflow, setNodeResult, clearNodeResult]);

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
      <Toolbar catalog={catalog} persistence={projectAdapter} validation={validation} onTestingNodesChange={(nodeIds) => setTestingNodeIds(new Set(nodeIds))} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Palette catalog={catalog} />
        <ReactFlowProvider>
          <Canvas catalog={catalog} onSelectNode={setSelectedNodeId} onSelectEdge={setSelectedEdgeId} testingNodeIds={testingNodeIds} />
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
            onCancelTest={handleCancelTest}
            isTesting={testingNodeIds.has(selectedNode.id)}
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

export function App() {
  return (
    <ProjectProvider adapter={projectAdapter}>
      <WorkflowEditorContent />
    </ProjectProvider>
  );
}
