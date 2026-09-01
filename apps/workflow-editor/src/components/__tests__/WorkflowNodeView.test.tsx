import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WorkflowNodeView } from '../WorkflowNodeView';
import type { FlowNode } from '../../adapters/react-flow-adapter';
import type { PluginManifest } from '@runflux/plugin-system/types';

function manifest(category: PluginManifest['category']): PluginManifest {
  return { id: `m-${category}`, name: `${category} node`, category, version: '1.0.0', parameters: [], supportedPlatforms: ['local'] };
}

// Minimal NodeProps stand-in — only the fields WorkflowNodeView actually reads.
function makeProps(manifestOrUndefined: PluginManifest | undefined, selected = false): NodeProps<FlowNode> {
  return {
    id: 'node-1',
    type: 'workflowNode',
    selected,
    data: {
      pluginId: manifestOrUndefined?.id ?? 'unknown',
      pluginVersion: '1.0.0',
      parameters: {},
      manifest: manifestOrUndefined,
      referenceStatus: manifestOrUndefined ? { status: 'ok' as const } : { status: 'missing' as const },
    },
  } as NodeProps<FlowNode>;
}

function renderNode(manifestOrUndefined: PluginManifest | undefined) {
  return render(
    <ReactFlowProvider>
      <WorkflowNodeView {...makeProps(manifestOrUndefined)} />
    </ReactFlowProvider>,
  );
}

describe('WorkflowNodeView — handle layout by category', () => {
  it('a trigger node has no target (input) handle, only a source (output) handle', () => {
    const { container } = renderNode(manifest('trigger'));
    expect(container.querySelector('.react-flow__handle-left')).toBeNull();
    expect(container.querySelector('.react-flow__handle-right')).not.toBeNull();
  });

  it('an output node has no source (output) handle, only a target (input) handle', () => {
    const { container } = renderNode(manifest('output'));
    expect(container.querySelector('.react-flow__handle-right')).toBeNull();
    expect(container.querySelector('.react-flow__handle-left')).not.toBeNull();
  });

  it('an action node has both a target and a source handle', () => {
    const { container } = renderNode(manifest('action'));
    expect(container.querySelector('.react-flow__handle-left')).not.toBeNull();
    expect(container.querySelector('.react-flow__handle-right')).not.toBeNull();
  });

  it('a node with an unresolved manifest (missing plugin) defaults to showing both handles', () => {
    const { container } = renderNode(undefined);
    expect(container.querySelector('.react-flow__handle-left')).not.toBeNull();
    expect(container.querySelector('.react-flow__handle-right')).not.toBeNull();
  });
});
