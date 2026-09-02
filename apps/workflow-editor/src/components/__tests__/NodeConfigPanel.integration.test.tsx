import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NodeConfigPanel } from '../NodeConfigPanel';
import type { PluginManifest } from '@runflux/plugin-system/types';
import type { NodeResult } from '@runflux/validation-runtime';

const manifest: PluginManifest = {
  id: 'trigger-manual-example',
  name: 'Manual Trigger (Example)',
  category: 'trigger',
  version: '1.0.0',
  parameters: [{ name: 'label', label: 'Label', type: 'string', required: false, default: 'Manual run' }],
  supportedPlatforms: ['local'],
};

const setManifest: PluginManifest = {
  id: 'set',
  name: 'Edit Fields (Set)',
  category: 'action',
  version: '1.0.0',
  parameters: [
    { name: 'fields', label: 'Fields', type: 'json', required: true, default: [] },
    { name: 'includeOtherFields', label: 'Include other input fields', type: 'boolean', required: false, default: false },
  ],
  supportedPlatforms: ['local'],
};

/**
 * Mimics App.tsx's real wiring: `values` is store state, and every keystroke
 * round-trips through a parent re-render with a brand-new `values` object —
 * exactly like Zustand producing a new `node.parameters` object on every
 * `updateNodeParameters` call.
 */
function Harness() {
  const [parameters, setParameters] = useState<Record<string, unknown>>({});
  return (
    <div>
      <div data-testid="stored-value">{JSON.stringify(parameters)}</div>
      {/* Inline arrow function, same as App.tsx: `onChange={(values) => updateNodeParameters(id, values)}` — a fresh function identity every render, unlike a stable useState setter. */}
      <NodeConfigPanel
        manifest={manifest}
        values={parameters}
        onChange={(values) => setParameters(values)}
        onClose={() => {}}
      />
    </div>
  );
}

function SetHarness({ initialParameters = {} }: { initialParameters?: Record<string, unknown> }) {
  const [parameters, setParameters] = useState<Record<string, unknown>>(initialParameters);
  return (
    <div>
      <div data-testid="stored-set-value">{JSON.stringify(parameters)}</div>
      <NodeConfigPanel
        manifest={setManifest}
        values={parameters}
        onChange={(values) => setParameters(values)}
        onClose={() => {}}
      />
    </div>
  );
}

function ExecutedSetHarness() {
  const [parameters, setParameters] = useState<Record<string, unknown>>({
    fields: [{ name: 'greeting', value: '' }],
    includeOtherFields: false,
  });
  const [testResult, setTestResult] = useState<NodeResult | undefined>({
    nodeId: 'set-1',
    input: { name: 'Ada' },
    output: { greeting: '' },
    error: null,
    startedAt: 't0',
    finishedAt: 't1',
  });

  return (
    <div>
      <div data-testid="stored-executed-set-value">{JSON.stringify(parameters)}</div>
      <NodeConfigPanel
        manifest={setManifest}
        values={parameters}
        onChange={(values) => {
          setParameters(values);
          setTestResult(undefined);
        }}
        onClose={() => {}}
        onTest={() => {}}
        testResult={testResult}
      />
    </div>
  );
}

describe('NodeConfigPanel — repeated typing across parent re-renders (store round-trip)', () => {
  it('keeps accepting keystrokes after the parent re-renders with a fresh values object', async () => {
    render(<Harness />);
    const input = screen.getByLabelText('Label');

    fireEvent.change(input, { target: { value: 'h' } });
    await waitFor(() => expect(screen.getByTestId('stored-value')).toHaveTextContent('"h"'));

    fireEvent.change(input, { target: { value: 'he' } });
    await waitFor(() => expect(screen.getByTestId('stored-value')).toHaveTextContent('"he"'));

    fireEvent.change(input, { target: { value: 'hello' } });
    await waitFor(() => expect(screen.getByTestId('stored-value')).toHaveTextContent('"hello"'));

    expect(input).toHaveValue('hello');
  });
});

describe('NodeConfigPanel — set fields from an empty or legacy configuration (004-core-nodes-catalog, E007–E009)', () => {
  it('shows the Fields editor immediately when a new set node has empty parameters', () => {
    render(<SetHarness />);

    expect(screen.getByRole('button', { name: 'Fields' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '+ Add field' })).toBeInTheDocument();
  });

  it('adds Name above Value and persists the canonical fields list', async () => {
    render(<SetHarness />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add field' }));

    const name = screen.getByLabelText('Row 1 Name');
    const value = screen.getByLabelText('Row 1 Value');
    expect(name.closest('label')).not.toBe(value.closest('label'));

    fireEvent.change(name, { target: { value: 'message' } });
    fireEvent.change(value, { target: { value: 'hello' } });

    await waitFor(() => {
      expect(screen.getByTestId('stored-set-value')).toHaveTextContent('"fields":[{"name":"message","value":"hello"}]');
    });
  });

  it('repairs a map entered through the old JSON-only flow into fields that the set executor can emit', async () => {
    render(<SetHarness initialParameters={{ fields: { message: 'hello' }, includeOtherFields: false }} />);

    await waitFor(() => {
      expect(screen.getByTestId('stored-set-value')).toHaveTextContent('"fields":[{"name":"message","value":"hello"}]');
    });
    expect(screen.getByLabelText('Row 1 Name')).toHaveValue('message');
    expect(screen.getByLabelText('Row 1 Value')).toHaveValue('hello');
  });
});

describe('NodeConfigPanel — retained execution input and explicit set value types (004-core-nodes-catalog, E010–E011)', () => {
  it('keeps the previous input visible and available to $json previews after an edit invalidates the output', async () => {
    render(<ExecutedSetHarness />);

    expect(screen.getByTestId('node-test-result')).toHaveTextContent('"name": "Ada"');
    fireEvent.change(screen.getByLabelText('Row 1 Value'), { target: { value: '{{ $json.name }}' } });

    await waitFor(() => {
      expect(screen.getByTestId('stored-executed-set-value')).toHaveTextContent('{{ $json.name }}');
    });
    expect(screen.getByTestId('node-test-result')).toHaveTextContent('"name": "Ada"');
    expect(screen.getByTestId('expression-preview-row-1-value')).toHaveTextContent('Ada');
    expect(screen.getByTestId('node-test-result')).not.toHaveTextContent('OUTPUT');
  });

  it('stores the JSON value selected for each supported set field type', async () => {
    render(<SetHarness initialParameters={{ fields: [{ name: 'value', value: '' }], includeOtherFields: false }} />);
    const type = screen.getByLabelText('Row 1 Type');

    fireEvent.change(type, { target: { value: 'number' } });
    await waitFor(() => expect(screen.getByTestId('stored-set-value')).toHaveTextContent('"value":0'));
    fireEvent.change(screen.getByLabelText('Row 1 Value'), { target: { value: '42' } });
    await waitFor(() => expect(screen.getByTestId('stored-set-value')).toHaveTextContent('"value":42'));

    fireEvent.change(type, { target: { value: 'boolean' } });
    await waitFor(() => expect(screen.getByTestId('stored-set-value')).toHaveTextContent('"value":false'));
    fireEvent.change(screen.getByLabelText('Row 1 Value'), { target: { value: 'true' } });
    await waitFor(() => expect(screen.getByTestId('stored-set-value')).toHaveTextContent('"value":true'));

    fireEvent.change(type, { target: { value: 'null' } });
    await waitFor(() => expect(screen.getByTestId('stored-set-value')).toHaveTextContent('"value":null'));
    fireEvent.change(type, { target: { value: 'array' } });
    await waitFor(() => expect(screen.getByTestId('stored-set-value')).toHaveTextContent('"value":[]'));
    fireEvent.change(type, { target: { value: 'object' } });
    await waitFor(() => expect(screen.getByTestId('stored-set-value')).toHaveTextContent('"value":{}'));
  });
});
