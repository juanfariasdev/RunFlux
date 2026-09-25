import { describe, expect, it } from 'vitest';
import { Position } from '@xyflow/react';
import {
  fromReactFlowEdge,
  toReactFlowEdge,
  toReactFlowNode,
} from '../react-flow-adapter';
import type { WorkflowConnection, WorkflowNode } from '@runflux/workflow-model/types';
import type { PluginManifest } from '@runflux/plugin-system/sdk';

const node: WorkflowNode = {
  id: 'node-1',
  pluginId: 'trigger-cron',
  pluginVersion: '1.0.0',
  parameters: { schedule: '* * * * *' },
  position: { x: 10, y: 20 },
};

const manifest: PluginManifest = {
  id: 'trigger-cron',
  name: 'Cron Trigger',
  category: 'trigger',
  version: '1.0.0',
  parameters: [],
  supportedPlatforms: ['local'],
};

const connection: WorkflowConnection = {
  sourceNodeId: 'node-1',
  sourceOutput: 'main',
  targetNodeId: 'node-2',
  targetInput: 'main',
};

describe('toReactFlowNode', () => {
  it('carries id, position, and every canonical field', () => {
    const flowNode = toReactFlowNode(node, manifest, { status: 'ok' });

    expect(flowNode).toMatchObject({
      id: 'node-1',
      position: { x: 10, y: 20 },
      data: { pluginId: 'trigger-cron', pluginVersion: '1.0.0', parameters: { schedule: '* * * * *' }, appearance: {} },
    });
    expect(flowNode.parentId).toBeUndefined();
  });

  it('carries the resolved manifest and reference status as display-only data', () => {
    const flowNode = toReactFlowNode(node, manifest, { status: 'ok' });
    expect(flowNode.data.manifest).toEqual(manifest);
    expect(flowNode.data.referenceStatus).toEqual({ status: 'ok' });
  });

  it('tolerates an undefined manifest (plugin not resolved) without throwing', () => {
    const flowNode = toReactFlowNode(node, undefined, { status: 'missing' });
    expect(flowNode.data.manifest).toBeUndefined();
    expect(flowNode.data.referenceStatus).toEqual({ status: 'missing' });
  });

  it('uses top and bottom node positions for vertical layouts', () => {
    const flowNode = toReactFlowNode(node, manifest, { status: 'ok' }, undefined, false, 'vertical');
    expect(flowNode.targetPosition).toBe(Position.Top);
    expect(flowNode.sourcePosition).toBe(Position.Bottom);
    expect(flowNode.data.layout).toBe('vertical');
  });
});

describe('toReactFlowEdge / fromReactFlowEdge round-trip', () => {
  it('preserves every canonical field through a round trip', () => {
    const edge = toReactFlowEdge(connection);
    const roundTripped = fromReactFlowEdge(edge);

    expect(roundTripped).toEqual(connection);
  });

  it('generates a stable, unique id derived from the connection endpoints', () => {
    const edge = toReactFlowEdge(connection);
    expect(edge.id).toBe('node-1:main->node-2:main');
  });

  it('defaults sourceOutput/targetInput to "main" when a React Flow edge omits handles', () => {
    const bareEdge = { id: 'x', source: 'a', target: 'b' };
    const result = fromReactFlowEdge(bareEdge);
    expect(result).toEqual({
      sourceNodeId: 'a',
      sourceOutput: 'main',
      targetNodeId: 'b',
      targetInput: 'main',
    });
  });
});
