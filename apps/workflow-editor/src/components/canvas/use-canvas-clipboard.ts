import { useCallback, useRef } from 'react';
import type { WorkflowConnection, WorkflowNode } from '@runflux/workflow-model/types';

interface CanvasClipboardOptions {
  readonly nodes: readonly WorkflowNode[];
  readonly connections: readonly WorkflowConnection[];
  readonly selectedNodeIds: ReadonlySet<string>;
  readonly addSubgraph: (nodes: WorkflowNode[], connections: WorkflowConnection[]) => void;
  readonly selectNodes: (nodeIds: Set<string>) => void;
  readonly onSelectNode: (nodeId: string | undefined) => void;
  readonly onSelectEdge?: (edgeId: string | undefined) => void;
}

function cloneNode(node: WorkflowNode): WorkflowNode {
  return {
    ...node,
    parameters: structuredClone(node.parameters),
    position: { ...node.position },
    ...(node.appearance ? { appearance: { ...node.appearance } } : {}),
  };
}

/**
 * Copy and paste of the selected nodes with the connections between them. Each paste gets new ids
 * and moves one more step down and to the right, keeping nodes inside a copied subflow in place.
 */
export function useCanvasClipboard({ nodes, connections, selectedNodeIds, addSubgraph, selectNodes, onSelectNode, onSelectEdge }: CanvasClipboardOptions) {
  const clipboardRef = useRef<{ nodes: WorkflowNode[]; connections: WorkflowConnection[]; pasteCount: number } | undefined>(undefined);

  const copySelection = useCallback(() => {
    const selected = nodes.filter((node) => selectedNodeIds.has(node.id));
    if (selected.length === 0) return false;
    const ids = new Set(selected.map((node) => node.id));
    clipboardRef.current = {
      nodes: selected.map(cloneNode),
      connections: connections
        .filter((connection) => ids.has(connection.sourceNodeId) && ids.has(connection.targetNodeId))
        .map((connection) => ({ ...connection })),
      pasteCount: 0,
    };
    return true;
  }, [selectedNodeIds, connections, nodes]);

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
    selectNodes(new Set(pastedNodes.map((node) => node.id)));
    onSelectEdge?.(undefined);
    onSelectNode(pastedNodes.length === 1 ? pastedNodes[0].id : undefined);
    return true;
  }, [addSubgraph, onSelectEdge, onSelectNode, selectNodes]);

  /** Whether something was copied; read while rendering, like the clipboard itself. */
  const hasCopiedNodes = () => Boolean(clipboardRef.current?.nodes.length);

  return { copySelection, pasteClipboard, hasCopiedNodes };
}
