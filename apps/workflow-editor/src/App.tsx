import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import type { PluginManifest } from '@runflux/plugin-system/sdk';
import { HttpPluginCatalogAdapter } from './adapters/plugin-catalog-adapter';
import { HttpValidationRuntimeAdapter } from './adapters/validation-runtime-adapter';
import { HttpProjectApiAdapter } from './adapters/project-api-adapter';
import { HttpWebhookTestingAdapter } from './adapters/webhook-testing-adapter';
import { connectionId } from './adapters/react-flow-adapter';
import { Canvas } from './components/Canvas';
import { Palette } from './components/Palette';
import { Toolbar } from './components/Toolbar';
import { useWorkflowStore } from './store/workflow-store';
import { ProjectProvider, useProject } from './context/ProjectContext';
import { projectEnvironment } from './adapters/project-environment';

const catalog = new HttpPluginCatalogAdapter();
const projectAdapter = new HttpProjectApiAdapter();
const validation = new HttpValidationRuntimeAdapter();
const webhooks = new HttpWebhookTestingAdapter();
const NodeConfigPanel = lazy(() => import('./components/NodeConfigPanel').then((module) => ({ default: module.NodeConfigPanel })));
const EdgeConfigPanel = lazy(() => import('./components/EdgeConfigPanel').then((module) => ({ default: module.EdgeConfigPanel })));

function WorkflowEditorContent() {
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | undefined>();
  const workflow = useWorkflowStore((s) => s.workflow);
  const nodes = workflow.nodes;
  const connections = workflow.connections;
  const nodeResults = useWorkflowStore((s) => s.nodeResults);
  const setNodeResults = useWorkflowStore((s) => s.setNodeResults);
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

  const { isDirty, envVars } = useProject();

  // The project's variables, for expression previews and as `$env` of test runs.
  const envScope = useMemo(() => projectEnvironment(envVars), [envVars]);

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
      await webhooks.cancelListeners();
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
      const cachedResults = Object.values(nodeResults).filter((result) => result.nodeId !== nodeId);
      const result = await validation.runNode(workflow, nodeId, { mode: 'sandbox', environment: envScope }, cachedResults);
      setNodeResult(result);
    } finally {
      setTestingNodeIds(new Set());
    }
  }, [workflow, nodeResults, setNodeResult, clearNodeResult, envScope]);

  const handleTestToNode = useCallback(async (nodeId: string) => {
    const pathNodeIds = upstreamNodeIds(workflow, nodeId);
    for (const id of pathNodeIds) clearNodeResult(id);
    setTestingNodeIds(pathNodeIds);
    try {
      const result = await validation.runToNode(workflow, nodeId, { mode: 'sandbox', environment: envScope });
      setNodeResults(result.nodeResults ?? []);
    } finally {
      setTestingNodeIds(new Set());
    }
  }, [workflow, setNodeResults, clearNodeResult, envScope]);

  useEffect(() => {
    let cancelled = false;
    catalog.listPlugins().then((grouped) => {
      if (!cancelled) setManifestsById(new Map(Object.values(grouped).flat().map((manifest) => [manifest.id, manifest])));
    });
    return () => { cancelled = true; };
  }, []);

  const selectedManifest = selectedNode ? manifestsById.get(selectedNode.pluginId) : undefined;

  const nodeScope = useMemo(() => {
    const scope: Record<string, { json: unknown }> = {};
    for (const node of nodes) {
      const res = nodeResults[node.id];
      const entry = { json: res?.output ?? {} };
      scope[node.id] = entry;
      if (node.appearance?.label) {
        scope[node.appearance.label] = entry;
      }
    }
    return scope;
  }, [nodes, nodeResults]);

  return (
    <div className="flex h-full min-w-[900px] flex-col overflow-hidden bg-slate-50 text-slate-900">
      <Toolbar catalog={catalog} persistence={projectAdapter} validation={validation} webhooks={webhooks} onTestingNodesChange={(nodeIds) => setTestingNodeIds(new Set(nodeIds))} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Palette catalog={catalog} />
        <ReactFlowProvider>
          <Canvas
            catalog={catalog}
            onSelectNode={setSelectedNodeId}
            onSelectEdge={setSelectedEdgeId}
            onTestNode={handleTestNode}
            onTestToNode={handleTestToNode}
            testingNodeIds={testingNodeIds}
          />
        </ReactFlowProvider>
        {selectedNode && (
          <Suspense fallback={null}>
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
              onSendTestRequest={(request) => void webhooks.send(request)}
              isTesting={testingNodeIds.has(selectedNode.id)}
              testResult={nodeResults[selectedNode.id]}
              nodeScope={nodeScope}
              envScope={envScope}
            />
          </Suspense>
        )}
        {selectedConnection && (
          <Suspense fallback={null}>
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
          </Suspense>
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

function upstreamNodeIds(workflow: { nodes: Array<{ id: string }>; connections: Array<{ sourceNodeId: string; targetNodeId: string }> }, nodeId: string): Set<string> {
  const incoming = new Map<string, string[]>();
  for (const connection of workflow.connections) {
    const sources = incoming.get(connection.targetNodeId);
    if (sources) sources.push(connection.sourceNodeId);
    else incoming.set(connection.targetNodeId, [connection.sourceNodeId]);
  }
  const found = new Set<string>();
  const queue = [nodeId];
  while (queue.length > 0) {
    const current = queue.pop()!;
    if (found.has(current)) continue;
    found.add(current);
    for (const source of incoming.get(current) ?? []) queue.push(source);
  }
  return found;
}
