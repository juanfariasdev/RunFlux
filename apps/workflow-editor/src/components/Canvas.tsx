import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  SelectionMode,
  useReactFlow,
  useViewport,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type OnNodeDrag,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { PluginManifest } from '@runflux/plugin-system/sdk';
import type { PluginCatalogAdapter } from '../adapters/plugin-catalog-adapter';
import { fromReactFlowEdge, toReactFlowEdge, toReactFlowNode, type FlowNode } from '../adapters/react-flow-adapter';
import { isConnectionCompatible } from '../domain/connection-compatibility';
import { layoutWorkflowNodes, type WorkflowLayout } from '../domain/layout';
import type { WorkflowNode } from '@runflux/workflow-model/types';
import { useWorkflowStore } from '../store/workflow-store';
import { SubflowNodeView, WorkflowNodeView } from './WorkflowNodeView';

const nodeTypes = { workflowNode: WorkflowNodeView, subflowNode: SubflowNodeView };
const PLUGIN_DRAG_TYPE = 'application/runflux-plugin-id';
const DEFAULT_NODE_WIDTH = 220;
const DEFAULT_NODE_HEIGHT = 104;
type DraggedPlugin = Pick<PluginManifest, 'id' | 'name' | 'category' | 'version'>;
type ContextMenuState = { x: number; y: number } | undefined;

export interface CanvasProps {
  catalog: PluginCatalogAdapter;
  onSelectNode: (nodeId: string | undefined) => void;
  onSelectEdge?: (edgeId: string | undefined) => void;
  onTestNode?: (nodeId: string) => void;
  onTestToNode?: (nodeId: string) => void;
  /** Node ids currently being tested (single node in isolation, or every Webhook Trigger in a whole-workflow run) — each shows the waiting/spinning badge. */
  testingNodeIds?: Set<string>;
}

export function Canvas({ catalog, onSelectNode, onSelectEdge, onTestNode, onTestToNode, testingNodeIds }: CanvasProps) {
  const workflow = useWorkflowStore((state) => state.workflow);
  const nodeResults = useWorkflowStore((state) => state.nodeResults);
  const addNode = useWorkflowStore((state) => state.addNode);
  const addSubgraph = useWorkflowStore((state) => state.addSubgraph);
  const addConnection = useWorkflowStore((state) => state.addConnection);
  const removeNodes = useWorkflowStore((state) => state.removeNodes);
  const removeConnection = useWorkflowStore((state) => state.removeConnection);
  const updateNodeGeometry = useWorkflowStore((state) => state.updateNodeGeometry);
  const replaceNodes = useWorkflowStore((state) => state.replaceNodes);
  const undo = useWorkflowStore((state) => state.undo);
  const redo = useWorkflowStore((state) => state.redo);
  const canUndo = useWorkflowStore((state) => state.historyPast.length > 0);
  const canRedo = useWorkflowStore((state) => state.historyFuture.length > 0);
  const beginHistoryTransaction = useWorkflowStore((state) => state.beginHistoryTransaction);
  const endHistoryTransaction = useWorkflowStore((state) => state.endHistoryTransaction);
  const [manifests, setManifests] = useState<Record<string, PluginManifest>>({});
  const [rejectionMessage, setRejectionMessage] = useState<string>();
  const [isDragActive, setIsDragActive] = useState(false);
  const [dragPoint, setDragPoint] = useState({ x: 0, y: 0 });
  const [draggedPlugin, setDraggedPlugin] = useState<DraggedPlugin>();
  const [layout, setLayout] = useState<WorkflowLayout>('horizontal');
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>();
  const canvasRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const dragDepth = useRef(0);
  const clipboardRef = useRef<{
    nodes: WorkflowNode[];
    connections: typeof workflow.connections;
    pasteCount: number;
  } | undefined>(undefined);
  const { fitView, screenToFlowPosition } = useReactFlow();
  const { zoom } = useViewport();

  const manifestFor = useCallback((pluginId: string) => manifests[pluginId], [manifests]);
  const nodes: FlowNode[] = useMemo(
    () => workflow.nodes.map((node) => {
      const flowNode = toReactFlowNode(node, manifestFor(node.pluginId), node.appearance?.shape === 'subflow' ? { status: 'ok' } : { status: manifestFor(node.pluginId) ? 'ok' : 'missing' }, nodeResults[node.id], testingNodeIds?.has(node.id) ?? false, layout);
      return {
        ...flowNode,
        selected: selectedNodeIds.has(node.id),
        data: {
          ...flowNode.data,
          ...(node.appearance?.shape === 'subflow' ? {} : {
            onTestNode: onTestNode ? () => onTestNode(node.id) : undefined,
            onTestToNode: onTestToNode ? () => onTestToNode(node.id) : undefined,
          }),
        },
      };
    }),
    [workflow.nodes, manifestFor, nodeResults, testingNodeIds, layout, selectedNodeIds, onTestNode, onTestToNode],
  );
  const edges = useMemo(() => workflow.connections.map(toReactFlowEdge), [workflow.connections]);

  const cloneNode = useCallback((node: WorkflowNode): WorkflowNode => ({
    ...node,
    parameters: structuredClone(node.parameters),
    position: { ...node.position },
    ...(node.appearance ? { appearance: { ...node.appearance } } : {}),
  }), []);

  const copySelection = useCallback(() => {
    const selected = workflow.nodes.filter((node) => selectedNodeIds.has(node.id));
    if (selected.length === 0) return false;
    const ids = new Set(selected.map((node) => node.id));
    clipboardRef.current = {
      nodes: selected.map(cloneNode),
      connections: workflow.connections
        .filter((connection) => ids.has(connection.sourceNodeId) && ids.has(connection.targetNodeId))
        .map((connection) => ({ ...connection })),
      pasteCount: 0,
    };
    return true;
  }, [cloneNode, selectedNodeIds, workflow.connections, workflow.nodes]);

  const pasteClipboard = useCallback(() => {
    const clipboard = clipboardRef.current;
    if (!clipboard || clipboard.nodes.length === 0) return false;
    clipboard.pasteCount += 1;
    const offset = clipboard.pasteCount * 32;
    const idMap = new Map(clipboard.nodes.map((node) => [node.id, crypto.randomUUID()]));
    const pastedNodes = clipboard.nodes.map((node) => {
      const copiedParent = node.parentId ? idMap.get(node.parentId) : undefined;
      return {
        ...cloneNode(node),
        id: idMap.get(node.id)!,
        position: copiedParent ? { ...node.position } : { x: node.position.x + offset, y: node.position.y + offset },
        ...(copiedParent ? { parentId: copiedParent } : node.parentId ? { parentId: node.parentId } : {}),
      };
    });
    const pastedConnections = clipboard.connections.map((connection) => ({
      ...connection,
      sourceNodeId: idMap.get(connection.sourceNodeId)!,
      targetNodeId: idMap.get(connection.targetNodeId)!,
    }));
    addSubgraph(pastedNodes, pastedConnections);
    setSelectedNodeIds(new Set(pastedNodes.map((node) => node.id)));
    onSelectEdge?.(undefined);
    onSelectNode(pastedNodes.length === 1 ? pastedNodes[0].id : undefined);
    return true;
  }, [addSubgraph, cloneNode, onSelectEdge, onSelectNode]);

  const openContextMenu = useCallback((clientX: number, clientY: number) => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    setContextMenu({
      x: Math.max(8, clientX - (bounds?.left ?? 0)),
      y: Math.max(8, clientY - (bounds?.top ?? 0)),
    });
  }, []);

  useEffect(() => {
    setSelectedNodeIds((current) => {
      const existing = new Set(workflow.nodes.map((node) => node.id));
      const next = new Set([...current].filter((id) => existing.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [workflow.nodes]);

  useEffect(() => {
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!contextMenuRef.current?.contains(event.target as globalThis.Node | null)) setContextMenu(undefined);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(undefined);
    };
    window.addEventListener('pointerdown', closeOnPointerDown);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOnPointerDown);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  // A panel edits one node, so it closes once the selection is not exactly one node.
  useEffect(() => {
    if (selectedNodeIds.size !== 1) onSelectNode(undefined);
  }, [selectedNodeIds, onSelectNode]);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      const element = target instanceof Element ? target : null;
      return Boolean(element?.closest('input, textarea, select, [contenteditable="true"]'));
    };
    const handleKeyboard = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (!modifier) return;
      const key = event.key.toLowerCase();

      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        setSelectedNodeIds(new Set());
        onSelectNode(undefined);
        onSelectEdge?.(undefined);
        return;
      }
      if (key === 'y') {
        event.preventDefault();
        redo();
        setSelectedNodeIds(new Set());
        onSelectNode(undefined);
        onSelectEdge?.(undefined);
        return;
      }
      if (key === 'c') {
        if (!copySelection()) return;
        event.preventDefault();
        return;
      }
      if (key === 'v') {
        if (!pasteClipboard()) return;
        event.preventDefault();
        return;
      }
      if (key === 'a') {
        event.preventDefault();
        setSelectedNodeIds(new Set(workflow.nodes.map((node) => node.id)));
        onSelectNode(undefined);
        onSelectEdge?.(undefined);
      }
    };

    window.addEventListener('keydown', handleKeyboard);
    return () => window.removeEventListener('keydown', handleKeyboard);
  }, [copySelection, onSelectEdge, onSelectNode, pasteClipboard, redo, undo, workflow.nodes]);

  useEffect(() => {
    let cancelled = false;
    catalog.listPlugins().then((grouped) => {
      if (cancelled) return;
      const resolved = Object.fromEntries(Object.values(grouped).flat().map((manifest) => [manifest.id, manifest]));
      setManifests((previous) => ({ ...resolved, ...previous }));
    });
    return () => { cancelled = true; };
  }, [catalog]);

  useEffect(() => {
    const pluginIds = workflow.nodes
      .filter((node) => node.appearance?.shape !== 'subflow')
      .map((node) => node.pluginId)
      .filter((pluginId) => !manifests[pluginId]);
    if (pluginIds.length === 0) return;

    let cancelled = false;
    catalog.listPlugins().then((grouped) => {
      if (cancelled) return;
      const resolved = Object.fromEntries(Object.values(grouped).flat().map((manifest) => [manifest.id, manifest]));
      setManifests((previous) => ({ ...resolved, ...previous }));
    });
    return () => { cancelled = true; };
  }, [catalog, manifests, workflow.nodes]);

  useEffect(() => {
    const clearDragState = () => {
      dragDepth.current = 0;
      setIsDragActive(false);
      setDraggedPlugin(undefined);
    };
    const beginDrag = (event: Event) => setDraggedPlugin((event as CustomEvent<DraggedPlugin>).detail);
    window.addEventListener('dragend', clearDragState);
    window.addEventListener('runflux:palette-drag-start', beginDrag);
    window.addEventListener('runflux:palette-drag-end', clearDragState);
    return () => {
      window.removeEventListener('dragend', clearDragState);
      window.removeEventListener('runflux:palette-drag-start', beginDrag);
      window.removeEventListener('runflux:palette-drag-end', clearDragState);
    };
  }, []);

  useEffect(() => {
    const handleAddPlugin = (event: Event) => {
      const manifest = (event as CustomEvent<DraggedPlugin>).detail;
      if (!manifest?.id) return;

      const bounds = canvasRef.current?.getBoundingClientRect();
      const center = screenToFlowPosition({
        x: (bounds?.left ?? 0) + (bounds?.width ?? 900) / 2,
        y: (bounds?.top ?? 0) + (bounds?.height ?? 600) / 2,
      });

      const offset = (workflow.nodes.length % 8) * 28;
      const newNode: WorkflowNode = {
        id: crypto.randomUUID(),
        pluginId: manifest.id,
        pluginVersion: manifest.version ?? '0.0.0',
        parameters: {},
        position: {
          x: (Number.isFinite(center.x) ? center.x : 200) - 110 + offset,
          y: (Number.isFinite(center.y) ? center.y : 150) - 52 + offset,
        },
        appearance: {
          shape: 'card',
          color: categoryColor(manifest.category),
          width: 220,
          height: 104,
        },
      };

      addNode(newNode);
      requestAnimationFrame(() => onSelectNode(newNode.id));
    };

    window.addEventListener('runflux:palette-add-plugin', handleAddPlugin);
    return () => window.removeEventListener('runflux:palette-add-plugin', handleAddPlugin);
  }, [addNode, onSelectNode, screenToFlowPosition, workflow.nodes.length]);

  const onConnect = useCallback((connection: Connection) => {
    const sourceNode = workflow.nodes.find((node) => node.id === connection.source);
    const targetNode = workflow.nodes.find((node) => node.id === connection.target);
    const compatible = isConnectionCompatible(
      sourceNode && manifestFor(sourceNode.pluginId),
      targetNode && manifestFor(targetNode.pluginId),
    );

    if (!compatible) {
      setRejectionMessage('This connection is incompatible with these node types.');
      return;
    }

    const accepted = addConnection({
      ...fromReactFlowEdge({ id: 'new-edge', ...connection }),
      type: 'smoothstep',
      color: '#64748b',
    });
    setRejectionMessage(accepted ? undefined : 'This connection would create a cycle and was blocked.');
  }, [workflow.nodes, manifestFor, addConnection]);

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    const removedIds = changes.filter((change) => change.type === 'remove').map((change) => change.id);
    if (removedIds.length > 0) {
      removeNodes(removedIds);
      setSelectedNodeIds((current) => new Set([...current].filter((id) => !removedIds.includes(id))));
    }
    const selectionChanges = changes.filter((change) => change.type === 'select');
    if (selectionChanges.length > 0) {
      setSelectedNodeIds((current) => {
        const next = new Set(current);
        for (const change of selectionChanges) {
          if (change.selected) next.add(change.id);
          else next.delete(change.id);
        }
        return next;
      });
    }
    for (const change of changes) {
      if (change.type === 'position' && change.position) {
        updateNodeGeometry(change.id, { position: change.position });
      } else if (change.type === 'dimensions' && change.dimensions && change.setAttributes) {
        updateNodeGeometry(change.id, { width: change.dimensions.width, height: change.dimensions.height });
      }
    }
  }, [onSelectNode, removeNodes, updateNodeGeometry]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    for (const change of changes) {
      if (change.type !== 'remove') continue;
      const edge = edges.find((candidate) => candidate.id === change.id);
      if (edge) removeConnection(edge.source, edge.sourceHandle ?? 'main', edge.target, edge.targetHandle ?? 'main');
    }
  }, [edges, removeConnection]);

  const resetDragState = useCallback(() => {
    dragDepth.current = 0;
    setIsDragActive(false);
    setDraggedPlugin(undefined);
  }, []);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const previewPlugin = draggedPlugin;
    let pluginId: string | undefined = event.dataTransfer.getData(PLUGIN_DRAG_TYPE);
    let payloadManifest: DraggedPlugin | undefined = previewPlugin;

    if (!pluginId) {
      const jsonStr = event.dataTransfer.getData('application/json');
      if (jsonStr) {
        try {
          const parsed = JSON.parse(jsonStr);
          if (parsed && typeof parsed.id === 'string') {
            pluginId = parsed.id;
            payloadManifest = parsed;
          }
        } catch {
          // ignore invalid JSON
        }
      }
    }

    if (!pluginId) {
      const text = event.dataTransfer.getData('text/plain');
      if (text) {
        pluginId = text;
      }
    }

    if (!pluginId) {
      pluginId = previewPlugin?.id;
    }

    resetDragState();
    if (!pluginId) return;

    const manifest = manifests[pluginId] || payloadManifest;
    const clientX = event.clientX || event.nativeEvent?.clientX || 0;
    const clientY = event.clientY || event.nativeEvent?.clientY || 0;

    let absolutePosition: { x: number; y: number };
    if (clientX && clientY) {
      absolutePosition = screenToFlowPosition({ x: clientX, y: clientY });
    } else {
      const bounds = canvasRef.current?.getBoundingClientRect();
      absolutePosition = screenToFlowPosition({
        x: (bounds?.left ?? 0) + (bounds?.width ?? 900) / 2,
        y: (bounds?.top ?? 0) + (bounds?.height ?? 600) / 2,
      });
    }

    if (!Number.isFinite(absolutePosition.x) || !Number.isFinite(absolutePosition.y)) {
      absolutePosition = { x: 200, y: 150 };
    }

    const nodePosition = {
      x: absolutePosition.x - DEFAULT_NODE_WIDTH / 2,
      y: absolutePosition.y - DEFAULT_NODE_HEIGHT / 2,
    };
    const parent = findContainingSubflow(workflow.nodes, absolutePosition);
    const position = parent
      ? { x: nodePosition.x - parent.position.x, y: nodePosition.y - parent.position.y }
      : nodePosition;

    const newNodeId = crypto.randomUUID();
    addNode({
      id: newNodeId,
      pluginId,
      pluginVersion: manifest?.version ?? previewPlugin?.version ?? '0.0.0',
      parameters: {},
      position,
      ...(parent ? { parentId: parent.id } : {}),
      appearance: {
        shape: 'card',
        color: categoryColor(manifest?.category ?? previewPlugin?.category),
        width: DEFAULT_NODE_WIDTH,
        height: DEFAULT_NODE_HEIGHT,
      },
    });
    requestAnimationFrame(() => onSelectNode(newNodeId));
  }, [addNode, draggedPlugin, manifests, onSelectNode, resetDragState, screenToFlowPosition, workflow.nodes]);

  const onDragEnter = useCallback((event: React.DragEvent) => {
    const types = Array.from(event.dataTransfer.types);
    if (
      types.length > 0 &&
      !types.includes(PLUGIN_DRAG_TYPE) &&
      !types.includes('text/plain') &&
      !types.includes('application/json')
    ) {
      return;
    }
    event.preventDefault();
    dragDepth.current += 1;
    setIsDragActive(true);
  }, []);

  const onDragLeave = useCallback((event: React.DragEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) dragDepth.current = 0;
    else dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragActive(false);
  }, []);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (bounds) setDragPoint({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
    if (!isDragActive) setIsDragActive(true);
  }, [isDragActive]);

  const onNodeDragStop: OnNodeDrag<FlowNode> = useCallback((_event, node) => {
    const currentParent = workflow.nodes.find((n) => n.id === node.parentId);
    const absolutePosition = currentParent
      ? { x: node.position.x + currentParent.position.x, y: node.position.y + currentParent.position.y }
      : node.position;

    const targetSubflow = findContainingSubflow(
      workflow.nodes.filter((n) => n.id !== node.id),
      absolutePosition,
    );

    if (targetSubflow && targetSubflow.id !== node.parentId) {
      updateNodeGeometry(node.id, {
        position: {
          x: absolutePosition.x - targetSubflow.position.x,
          y: absolutePosition.y - targetSubflow.position.y,
        },
        parentId: targetSubflow.id,
      });
    } else if (!targetSubflow && node.parentId) {
      updateNodeGeometry(node.id, {
        position: absolutePosition,
        parentId: null,
      });
    }
    endHistoryTransaction();
  }, [endHistoryTransaction, updateNodeGeometry, workflow.nodes]);

  const onNodeDragStart: OnNodeDrag<FlowNode> = useCallback(() => {
    beginHistoryTransaction();
  }, [beginHistoryTransaction]);

  const applyLayout = useCallback((layout: WorkflowLayout) => {
    setLayout(layout);
    replaceNodes(layoutWorkflowNodes(workflow.nodes, workflow.connections, layout));
    requestAnimationFrame(() => void fitView({ padding: 0.2, duration: 550 }));
  }, [fitView, replaceNodes, workflow.connections, workflow.nodes]);

  const addSubflow = useCallback(() => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    const center = screenToFlowPosition({
      x: (bounds?.left ?? 0) + (bounds?.width ?? 900) / 2,
      y: (bounds?.top ?? 0) + (bounds?.height ?? 600) / 2,
    });
    const node: WorkflowNode = {
      id: crypto.randomUUID(),
      pluginId: 'runflux.subflow',
      pluginVersion: '1.0.0',
      parameters: {},
      position: { x: center.x - 260, y: center.y - 150 },
      appearance: { shape: 'subflow', label: 'New subflow', color: '#8b5cf6', width: 520, height: 300 },
    };
    addNode(node);
    requestAnimationFrame(() => onSelectNode(node.id));
  }, [addNode, onSelectNode, screenToFlowPosition]);

  const deleteSelection = useCallback(() => {
    if (selectedNodeIds.size === 0) return;
    removeNodes([...selectedNodeIds]);
    setSelectedNodeIds(new Set());
    onSelectNode(undefined);
    onSelectEdge?.(undefined);
  }, [onSelectEdge, onSelectNode, removeNodes, selectedNodeIds]);

  const selectAllNodes = useCallback(() => {
    setSelectedNodeIds(new Set(workflow.nodes.map((node) => node.id)));
    onSelectNode(undefined);
    onSelectEdge?.(undefined);
  }, [onSelectEdge, onSelectNode, workflow.nodes]);

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: FlowNode) => {
    event.preventDefault();
    if (!selectedNodeIds.has(node.id)) {
      setSelectedNodeIds(new Set([node.id]));
      onSelectNode(node.id);
    } else if (selectedNodeIds.size !== 1) {
      onSelectNode(undefined);
    }
    onSelectEdge?.(undefined);
    openContextMenu(event.clientX, event.clientY);
  }, [onSelectEdge, onSelectNode, openContextMenu, selectedNodeIds]);

  const onPaneContextMenu = useCallback((event: MouseEvent | React.MouseEvent) => {
    event.preventDefault();
    onSelectEdge?.(undefined);
    openContextMenu(event.clientX, event.clientY);
  }, [onSelectEdge, openContextMenu]);

  const onSelectionContextMenu = useCallback((event: React.MouseEvent, selectedNodes: FlowNode[]) => {
    event.preventDefault();
    setSelectedNodeIds(new Set(selectedNodes.map((node) => node.id)));
    onSelectNode(undefined);
    onSelectEdge?.(undefined);
    openContextMenu(event.clientX, event.clientY);
  }, [onSelectEdge, onSelectNode, openContextMenu]);

  return (
    <main
      ref={canvasRef}
      className={`relative h-full min-w-0 flex-1 overflow-hidden transition-colors ${isDragActive ? 'bg-indigo-50/50' : 'bg-slate-50'}`}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      data-testid="canvas"
      data-drag-active={isDragActive ? 'true' : 'false'}
    >
      {workflow.nodes.length === 0 && !isDragActive && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-[3] flex w-80 -translate-x-1/2 -translate-y-1/2 flex-col items-center rounded-[20px] border border-dashed border-slate-300 bg-white/75 p-8 text-center text-slate-700 shadow-xl shadow-slate-200/40 backdrop-blur">
          <span className="mb-3 grid h-11 w-11 place-items-center rounded-[14px] bg-indigo-50 text-2xl text-indigo-600">＋</span>
          <strong className="text-sm">Build your first workflow</strong>
          <p className="mt-1 text-[11px] text-slate-400">Drag a plugin from the library or create a subflow.</p>
        </div>
      )}

      {isDragActive && (
        <div className="pointer-events-none absolute inset-0 z-[15]" aria-live="polite">
          <div className="absolute inset-2.5 rounded-[18px] border-2 border-dashed border-indigo-400 bg-indigo-500/5 shadow-[inset_0_0_60px_rgb(99_102_241_/.06)]" />
          {draggedPlugin ? (
            <div
              data-testid="dragged-node-preview"
              className="absolute flex h-[104px] w-[220px] items-center gap-3 rounded-[14px] border bg-white/95 px-4 shadow-2xl shadow-indigo-200/80 backdrop-blur"
              style={{
                left: dragPoint.x,
                top: dragPoint.y,
                borderColor: categoryColor(draggedPlugin.category),
                transform: `translate(-50%, -50%) scale(${zoom})`,
                transformOrigin: 'center',
              }}
            >
              <span className="absolute bottom-3 left-0 top-3 w-1 rounded-r" style={{ backgroundColor: categoryColor(draggedPlugin.category) }} />
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-50 text-sm font-extrabold" style={{ color: categoryColor(draggedPlugin.category) }}>
                {categorySymbol(draggedPlugin.category)}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <small className="text-[8px] font-extrabold uppercase tracking-[.12em]" style={{ color: categoryColor(draggedPlugin.category) }}>{categoryLabel(draggedPlugin.category)}</small>
                <strong className="truncate text-xs text-slate-800">{draggedPlugin.name}</strong>
                <small className="truncate text-[8px] text-slate-400">{draggedPlugin.id}</small>
              </span>
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-indigo-600 text-white shadow">＋</span>
            </div>
          ) : (
            <div className="absolute flex -translate-x-[22px] -translate-y-[25px] items-center gap-2 whitespace-nowrap rounded-xl border border-indigo-200 bg-white/95 px-3 py-2.5 text-indigo-800 shadow-2xl shadow-indigo-200" style={{ left: dragPoint.x, top: dragPoint.y }}>
              <span className="grid h-[23px] w-[23px] place-items-center rounded-lg bg-indigo-600 text-white">＋</span>
              <strong className="text-[11px]">Drop to add to the workflow</strong>
            </div>
          )}
        </div>
      )}

      {rejectionMessage && <div className="absolute left-1/2 top-[72px] z-20 -translate-x-1/2 rounded-[10px] border border-red-200 bg-red-50/95 px-3 py-2 text-[11px] font-semibold text-red-700 shadow-xl" role="alert">{rejectionMessage}</div>}

      <ReactFlow
        className="runflux-flow"
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStart={onNodeDragStart}
        onSelectionDragStart={beginHistoryTransaction}
        onSelectionDragStop={endHistoryTransaction}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onNodeClick={(_event, node) => { onSelectEdge?.(undefined); onSelectNode(node.id); }}
        onNodeContextMenu={onNodeContextMenu}
        onSelectionContextMenu={onSelectionContextMenu}
        onEdgeClick={(_event, edge) => { onSelectNode(undefined); onSelectEdge?.(edge.id); }}
        onPaneClick={() => { setSelectedNodeIds(new Set()); onSelectNode(undefined); onSelectEdge?.(undefined); }}
        onPaneContextMenu={onPaneContextMenu}
        connectionLineType={ConnectionLineType.SmoothStep}
        connectionLineStyle={{ stroke: '#4f46e5', strokeWidth: 2 }}
        defaultEdgeOptions={{ type: 'smoothstep' }}
        deleteKeyCode={['Backspace', 'Delete']}
        selectionKeyCode={['Meta', 'Control']}
        selectionOnDrag={multiSelectMode}
        selectionMode={SelectionMode.Partial}
        multiSelectionKeyCode={['Meta', 'Control']}
        panOnDrag={!multiSelectMode}
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.25}
        maxZoom={2.25}
        snapToGrid
        snapGrid={[16, 16]}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.25} color="#cbd5e1" />
        <Controls className="!overflow-hidden !rounded-xl !border !border-slate-200 !shadow-lg" position="bottom-left" showInteractive={false} />
        <MiniMap
          className="!overflow-hidden !rounded-[14px] !border !border-slate-200 !bg-white/95 !shadow-xl"
          position="bottom-right"
          pannable
          zoomable
          nodeColor={(node: FlowNode) => node.data.appearance.color ?? '#64748b'}
          nodeStrokeColor="#ffffff"
          nodeStrokeWidth={3}
          maskColor="rgba(15, 23, 42, 0.08)"
          ariaLabel="Workflow map"
        />
        <Panel position="top-center" className="!flex !items-center !gap-1 !rounded-xl !border !border-slate-200 !bg-white/95 !p-1 !shadow-xl !backdrop-blur">
          <button
            type="button"
            aria-pressed={multiSelectMode}
            className={`h-7 rounded-lg px-2.5 text-[10px] font-semibold transition ${multiSelectMode ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-indigo-50 hover:text-indigo-800'}`}
            onClick={() => setMultiSelectMode((active) => !active)}
            title="Ative este modo ou segure Ctrl/Command para selecionar vários nós"
          >
            ◫ Selecionar vários
          </button>
          {selectedNodeIds.size > 1 && (
            <span className="rounded-md bg-indigo-50 px-2 py-1 text-[9px] font-bold text-indigo-700" data-testid="multi-selection-count">
              {selectedNodeIds.size} selecionados
            </span>
          )}
          <span className="mx-1 h-[18px] w-px bg-slate-200" />
          <span className="px-1.5 text-[9px] font-extrabold uppercase tracking-wider text-slate-400 max-[1120px]:hidden">Layout</span>
          <button type="button" className="h-7 rounded-lg px-2.5 text-[10px] font-semibold text-slate-600 transition hover:bg-indigo-50 hover:text-indigo-800" onClick={() => applyLayout('horizontal')} title="Arrange from left to right">Horizontal</button>
          <button type="button" className="h-7 rounded-lg px-2.5 text-[10px] font-semibold text-slate-600 transition hover:bg-indigo-50 hover:text-indigo-800" onClick={() => applyLayout('vertical')} title="Arrange from top to bottom">Vertical</button>
          <button type="button" className="h-7 rounded-lg px-2.5 text-[10px] font-semibold text-slate-600 transition hover:bg-indigo-50 hover:text-indigo-800" onClick={() => applyLayout('grid')} title="Arrange connected workflows as a grid of groups">Grid</button>
          <span className="mx-1 h-[18px] w-px bg-slate-200" />
          <button type="button" className="h-7 rounded-lg bg-indigo-600 px-2.5 text-[10px] font-semibold text-white transition hover:bg-indigo-700" onClick={addSubflow}>＋ Subflow</button>
        </Panel>
      </ReactFlow>

      {contextMenu && (
        <div
          ref={contextMenuRef}
          role="menu"
          aria-label="Menu de contexto"
          data-testid="canvas-context-menu"
          className="absolute z-[60] w-56 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 text-[11px] shadow-2xl shadow-slate-900/15"
          style={{
            left: Math.min(contextMenu.x, Math.max(8, (canvasRef.current?.clientWidth ?? contextMenu.x + 232) - 232)),
            top: Math.min(contextMenu.y, Math.max(8, (canvasRef.current?.clientHeight ?? contextMenu.y + 300) - 300)),
          }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <ContextMenuButton
            label={selectedNodeIds.size > 1 ? `Copiar ${selectedNodeIds.size} itens` : 'Copiar'}
            shortcut="Ctrl/Cmd+C"
            disabled={selectedNodeIds.size === 0}
            onClick={() => { copySelection(); setContextMenu(undefined); }}
          />
          <ContextMenuButton
            label="Colar"
            shortcut="Ctrl/Cmd+V"
            disabled={!clipboardRef.current?.nodes.length}
            onClick={() => { pasteClipboard(); setContextMenu(undefined); }}
          />
          <ContextMenuButton
            label={selectedNodeIds.size > 1 ? `Excluir ${selectedNodeIds.size} itens` : 'Excluir'}
            shortcut="Delete"
            disabled={selectedNodeIds.size === 0}
            danger
            onClick={() => { deleteSelection(); setContextMenu(undefined); }}
          />
          <div className="my-1 h-px bg-slate-100" role="separator" />
          <ContextMenuButton
            label="Selecionar todos"
            shortcut="Ctrl/Cmd+A"
            disabled={workflow.nodes.length === 0}
            onClick={() => { selectAllNodes(); setContextMenu(undefined); }}
          />
          <div className="my-1 h-px bg-slate-100" role="separator" />
          <ContextMenuButton
            label="Desfazer"
            shortcut="Ctrl/Cmd+Z"
            disabled={!canUndo}
            onClick={() => { undo(); setSelectedNodeIds(new Set()); onSelectNode(undefined); setContextMenu(undefined); }}
          />
          <ContextMenuButton
            label="Refazer"
            shortcut="Ctrl/Cmd+Shift+Z"
            disabled={!canRedo}
            onClick={() => { redo(); setSelectedNodeIds(new Set()); onSelectNode(undefined); setContextMenu(undefined); }}
          />
        </div>
      )}
    </main>
  );
}

function ContextMenuButton({
  label,
  shortcut,
  disabled = false,
  danger = false,
  onClick,
}: {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-4 rounded-lg px-2.5 py-2 text-left font-semibold transition ${danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50'} disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent`}
    >
      <span>{label}</span>
      {shortcut && <span className="text-[9px] font-medium text-slate-400">{shortcut}</span>}
    </button>
  );
}

function findContainingSubflow(nodes: WorkflowNode[], point: { x: number; y: number }): WorkflowNode | undefined {
  return [...nodes].reverse().find((node) => {
    if (node.appearance?.shape !== 'subflow') return false;
    const width = node.appearance.width ?? 520;
    const height = node.appearance.height ?? 300;
    return point.x >= node.position.x && point.x <= node.position.x + width && point.y >= node.position.y && point.y <= node.position.y + height;
  });
}

function categoryColor(category: PluginManifest['category'] | undefined): string {
  switch (category) {
    case 'trigger': return '#10b981';
    case 'output': return '#f97316';
    case 'control-flow': return '#8b5cf6';
    case 'subworkflow': return '#0ea5e9';
    default: return '#4f46e5';
  }
}

function categoryLabel(category: PluginManifest['category']): string {
  switch (category) {
    case 'trigger': return 'Trigger';
    case 'output': return 'Output';
    case 'control-flow': return 'Control';
    case 'subworkflow': return 'Subflow';
    default: return 'Action';
  }
}

function categorySymbol(category: PluginManifest['category']): string {
  switch (category) {
    case 'trigger': return '↯';
    case 'output': return '→';
    case 'control-flow': return '◇';
    case 'subworkflow': return '▱';
    default: return '⌘';
  }
}
