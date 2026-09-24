import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WorkflowNodeView } from '../WorkflowNodeView';
import type { FlowNode } from '../../adapters/react-flow-adapter';
import type { PluginManifest } from '@runflux/plugin-system/types';
import type { NodeResult } from '@runflux/validation-runtime';

function manifest(category: PluginManifest['category'], outputs?: string[]): PluginManifest {
  return { id: `m-${category}`, name: `${category} node`, category, version: '1.0.0', parameters: [], supportedPlatforms: ['local'], outputs };
}

// Minimal NodeProps stand-in — only the fields WorkflowNodeView actually reads.
function makeProps(
  manifestOrUndefined: PluginManifest | undefined,
  selected = false,
  parameters: Record<string, unknown> = {},
  result?: NodeResult,
  isTesting = false,
  layout: 'horizontal' | 'vertical' | 'grid' = 'horizontal',
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
      isTesting,
      layout,
    },
  } as NodeProps<FlowNode>;
}

function renderNode(manifestOrUndefined: PluginManifest | undefined, parameters: Record<string, unknown> = {}, result?: NodeResult, isTesting = false, layout: 'horizontal' | 'vertical' | 'grid' = 'horizontal') {
  return render(
    <ReactFlowProvider>
      <WorkflowNodeView {...makeProps(manifestOrUndefined, false, parameters, result, isTesting, layout)} />
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

  it('an output-category node has a target handle and its default main source handle', () => {
    const { container } = renderNode(manifest('output'));
    expect(container.querySelector('.react-flow__handle-right')).not.toBeNull();
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

  it('keeps the main source handle on output-category nodes that have downstream connections', () => {
    const { container, getByTestId } = renderNode(manifest('output'), {}, undefined, false, 'vertical');
    expect(container.querySelector('.react-flow__handle-top')).not.toBeNull();
    expect(getByTestId('output-handle').classList).toContain('react-flow__handle-bottom');
    expect(getByTestId('output-handle').getAttribute('data-handleid')).toBe('main');
  });

  it('places vertical layout handles on top and bottom', () => {
    const { container } = renderNode(manifest('action', ['true', 'false']), {}, undefined, false, 'vertical');
    expect(container.querySelector('.react-flow__handle-top')).not.toBeNull();
    expect(container.querySelectorAll('.react-flow__handle-bottom')).toHaveLength(2);
    expect(container.querySelector('.react-flow__handle-left')).toBeNull();
    expect(container.querySelector('.react-flow__handle-right')).toBeNull();
  });
});

describe('WorkflowNodeView — named output handles (004-core-nodes-catalog, RF-08)', () => {
  it('renders exactly one unlabeled source handle when manifest.outputs is absent (legacy behavior preserved)', () => {
    const { container, queryAllByTestId } = renderNode(manifest('action'));
    expect(container.querySelectorAll('.react-flow__handle-right')).toHaveLength(1);
    expect(queryAllByTestId('output-handle-label')).toHaveLength(0);
  });

  it('renders one labeled source handle per entry in manifest.outputs', () => {
    const { container, getAllByTestId } = renderNode(manifest('control-flow', ['true', 'false']));
    expect(container.querySelectorAll('.react-flow__handle-right')).toHaveLength(2);
    const labels = getAllByTestId('output-handle-label').map((el) => el.textContent);
    expect(labels).toEqual(['true', 'false']);
  });

  it('places labels below output handles in vertical layout', () => {
    const { getAllByTestId } = renderNode(manifest('control-flow', ['true', 'false']), {}, undefined, false, 'vertical');
    for (const label of getAllByTestId('output-handle-label')) {
      expect(label.className).toContain('top-[14px]');
    }
  });

  it('gives each named output handle a distinct id matching its manifest.outputs entry', () => {
    const { getAllByTestId } = renderNode(manifest('control-flow', ['true', 'false']));
    const ids = getAllByTestId('output-handle').map((el) => el.getAttribute('data-handleid'));
    expect(ids).toEqual(['true', 'false']);
  });

  it('renders a single named handle for a manifest declaring exactly one output (e.g. filter)', () => {
    const { container, getAllByTestId } = renderNode(manifest('control-flow', ['main']));
    expect(container.querySelectorAll('.react-flow__handle-right')).toHaveLength(1);
    expect(getAllByTestId('output-handle-label').map((el) => el.textContent)).toEqual(['main']);
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

describe('WorkflowNodeView — testing badge (waiting for a webhook)', () => {
  it('shows no testing badge when the node is not being tested', () => {
    const { queryByTestId } = renderNode(manifest('trigger'));
    expect(queryByTestId('node-testing-badge')).toBeNull();
  });

  it('shows a spinning testing badge while the node is being tested', () => {
    const { getByTestId } = renderNode(manifest('trigger'), {}, undefined, true);
    expect(getByTestId('node-testing-badge')).toHaveAttribute('data-result-status', 'testing');
  });

  it('hides the testing badge in favor of the result badge once a stale result exists but isTesting is false', () => {
    const { queryByTestId, getByTestId } = renderNode(manifest('trigger'), {}, nodeResult(), false);
    expect(queryByTestId('node-testing-badge')).toBeNull();
    expect(getByTestId('node-result-badge')).toBeInTheDocument();
  });

  it('prefers the testing badge over a stale result badge while a new test is in flight', () => {
    const { getByTestId, queryByTestId } = renderNode(manifest('trigger'), {}, nodeResult(), true);
    expect(getByTestId('node-testing-badge')).toBeInTheDocument();
    expect(queryByTestId('node-result-badge')).toBeNull();
  });
});
