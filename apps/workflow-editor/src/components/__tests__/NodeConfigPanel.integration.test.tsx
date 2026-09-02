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

const conditionManifest: PluginManifest = {
  id: 'condition-if',
  name: 'If',
  category: 'control-flow',
  version: '1.0.0',
  parameters: [
    { name: 'conditions', label: 'Conditions', type: 'json', required: true, default: [] },
    { name: 'combinator', label: 'Combinator (and/or)', type: 'string', required: false, default: 'and' },
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

function RemountableSetHarness() {
  const [parameters, setParameters] = useState<Record<string, unknown>>({
    fields: [
      { name: 'expression', value: '' },
      { name: 'negative', value: '' },
    ],
    includeOtherFields: false,
  });
  const [visible, setVisible] = useState(true);

  return (
    <div>
      <div data-testid="stored-remountable-set-value">{JSON.stringify(parameters)}</div>
      <button type="button" onClick={() => setVisible(false)}>Hide panel</button>
      <button type="button" onClick={() => setVisible(true)}>Show panel</button>
      {visible && (
        <NodeConfigPanel
          manifest={setManifest}
          values={parameters}
          onChange={(values) => setParameters(values)}
          onClose={() => {}}
        />
      )}
    </div>
  );
}

function ConditionsHarness() {
  const [parameters, setParameters] = useState<Record<string, unknown>>({
    conditions: [{ leftValue: 'name', operator: 'equals', rightValue: 'Ada' }],
    combinator: 'and',
  });

  return (
    <div>
      <div data-testid="stored-condition-value">{JSON.stringify(parameters)}</div>
      <NodeConfigPanel
        manifest={conditionManifest}
        values={parameters}
        onChange={(values) => setParameters(values)}
        onClose={() => {}}
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
      expect(screen.getByTestId('stored-set-value')).toHaveTextContent('"fields":[{"name":"message","value":"hello","type":"string"}]');
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

  it('does not store text in a set field configured as Number', async () => {
    render(<SetHarness initialParameters={{ fields: [{ name: 'count', value: 3 }], includeOtherFields: false }} />);

    fireEvent.change(screen.getByLabelText('Row 1 Value'), { target: { value: 'not a number' } });

    await waitFor(() => {
      expect(screen.getByTestId('stored-set-value')).toHaveTextContent('"value":3');
    });
    expect(screen.getByTestId('stored-set-value')).not.toHaveTextContent('not a number');
    expect(screen.getByLabelText('Row 1 Value')).toHaveValue('3');
  });
});

describe('NodeConfigPanel — persisted set types and type-specific JSON shapes', () => {
  it('keeps Number selected for expression and partial negative values after the panel remounts', async () => {
    render(<RemountableSetHarness />);

    fireEvent.change(screen.getByLabelText('Row 1 Type'), { target: { value: 'number' } });
    fireEvent.change(screen.getByLabelText('Row 1 Value'), { target: { value: '{{ $json.count }}' } });
    fireEvent.change(screen.getByLabelText('Row 2 Type'), { target: { value: 'number' } });
    fireEvent.change(screen.getByLabelText('Row 2 Value'), { target: { value: '-' } });

    await waitFor(() => {
      const stored = JSON.parse(screen.getByTestId('stored-remountable-set-value').textContent ?? '{}');
      expect(stored.fields).toEqual([
        { name: 'expression', value: '{{ $json.count }}', type: 'number' },
        { name: 'negative', value: '-', type: 'number' },
      ]);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Hide panel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show panel' }));

    expect(screen.getByLabelText('Row 1 Type')).toHaveValue('number');
    expect(screen.getByLabelText('Row 2 Type')).toHaveValue('number');
  });

  it('rejects an object for Array and an array for Object', async () => {
    render(
      <SetHarness
        initialParameters={{
          fields: [
            { name: 'list', value: [] },
            { name: 'record', value: {} },
          ],
          includeOtherFields: false,
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText('Row 1 Value'), { target: { value: '{"wrong":true}' } });
    fireEvent.change(screen.getByLabelText('Row 2 Value'), { target: { value: '["wrong"]' } });

    await waitFor(() => {
      const stored = JSON.parse(screen.getByTestId('stored-set-value').textContent ?? '{}');
      expect(stored.fields).toEqual([
        { name: 'list', value: [] },
        { name: 'record', value: {} },
      ]);
    });
    expect(screen.getByLabelText('Row 1 Value')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Row 2 Value')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('NodeConfigPanel — unary condition operators', () => {
  it('clears and hides Right value when Operator is Is empty', async () => {
    render(<ConditionsHarness />);

    fireEvent.change(screen.getByLabelText('Row 1 Operator'), { target: { value: 'isEmpty' } });

    await waitFor(() => {
      const stored = JSON.parse(screen.getByTestId('stored-condition-value').textContent ?? '{}');
      expect(stored.conditions).toEqual([{ leftValue: 'name', operator: 'isEmpty', rightValue: '' }]);
    });
    expect(screen.queryByLabelText('Row 1 Right value')).not.toBeInTheDocument();
  });
});
