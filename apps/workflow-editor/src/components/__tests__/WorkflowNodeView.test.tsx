import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WorkflowNodeView } from '../WorkflowNodeView';
import type { FlowNode } from '../../adapters/react-flow-adapter';
import type { PluginManifest } from '@runflux/plugin-system/types';
import type { NodeResult } from '@runflux/validation-runtime';

function manifest(category: PluginManifest['category']): PluginManifest {
  return { id: `m-${category}`, name: `${category} node`, category, version: '1.0.0', parameters: [], supportedPlatforms: ['local'] };
}

// Minimal NodeProps stand-in — only the fields WorkflowNodeView actually reads.
function makeProps(
  manifestOrUndefined: PluginManifest | undefined,
  selected = false,
  parameters: Record<string, unknown> = {},
  result?: NodeResult,
): NodeProps<FlowNode> {
  return {
    id: 'node-1',
    type: 'workflowNode',
    selected,
    data: {
      pluginId: manifestOrUndefined?.id ?? 'unknown',
      pluginVersion: '1.0.0',
      parameters,
      manifest: manifestOrUndefined,
      referenceStatus: manifestOrUndefined ? { status: 'ok' as const } : { status: 'missing' as const },
      result,
    },
  } as NodeProps<FlowNode>;
}

function renderNode(manifestOrUndefined: PluginManifest | undefined, parameters: Record<string, unknown> = {}, result?: NodeResult) {
  return render(
    <ReactFlowProvider>
      <WorkflowNodeView {...makeProps(manifestOrUndefined, false, parameters, result)} />
    </ReactFlowProvider>,
  );
}

function nodeResult(error: string | null = null): NodeResult {
  return { nodeId: 'node-1', input: null, output: 'ok', error, startedAt: 't0', finishedAt: 't1' };
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

describe('WorkflowNodeView — node title reflects the user-set "label" parameter', () => {
  it('falls back to the plugin manifest name when no label parameter is set', () => {
    const { getByTestId } = renderNode(manifest('action'));
    expect(getByTestId('workflow-node')).toHaveTextContent('action node');
  });

  it('shows the user-typed label instead of the manifest name once one is set', () => {
    const { getByTestId } = renderNode(manifest('action'), { label: 'My Custom Label' });
    expect(getByTestId('workflow-node')).toHaveTextContent('My Custom Label');
  });

  it('ignores a label parameter that is empty or only whitespace', () => {
    const { getByTestId } = renderNode(manifest('action'), { label: '   ' });
    expect(getByTestId('workflow-node')).toHaveTextContent('action node');
  });
});


describe('WorkflowNodeView — validation result badge (003-validation-runtime, RF-02/RF-05)', () => {
  it('shows no badge when the node has never been tested', () => {
    const { queryByTestId } = renderNode(manifest('action'));
    expect(queryByTestId('node-result-badge')).toBeNull();
  });

  it('shows a success badge after a successful test', () => {
    const { getByTestId } = renderNode(manifest('action'), {}, nodeResult());
    expect(getByTestId('node-result-badge')).toHaveAttribute('data-result-status', 'success');
  });

  it('shows an error badge, with the error as its title, after a failed test', () => {
    const { getByTestId } = renderNode(manifest('action'), {}, nodeResult('boom'));
    const badge = getByTestId('node-result-badge');
    expect(badge).toHaveAttribute('data-result-status', 'error');
    expect(badge).toHaveAttribute('title', 'boom');
  });

  it('does not show a result badge for a node whose plugin is missing, even if it has a stale result', () => {
    const { queryByTestId } = renderNode(undefined, {}, nodeResult());
    expect(queryByTestId('node-result-badge')).toBeNull();
  });
});
