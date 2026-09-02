import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NodeConfigPanel } from '../NodeConfigPanel';
import type { PluginManifest } from '@runflux/plugin-system/types';

const manifest: PluginManifest = {
  id: 'trigger-manual-example',
  name: 'Manual Trigger (Example)',
  category: 'trigger',
  version: '1.0.0',
  parameters: [{ name: 'label', label: 'Label', type: 'string', required: false, default: 'Manual run' }],
  supportedPlatforms: ['local'],
};

describe('NodeConfigPanel — typing propagates to onChange (RF-04)', () => {
  it('calls onChange with the updated value as soon as the user types', async () => {
    const onChange = vi.fn();
    render(<NodeConfigPanel manifest={manifest} values={{ label: '' }} onChange={onChange} onClose={vi.fn()} />);

    const input = screen.getByLabelText('Label');
    fireEvent.change(input, { target: { value: 'hello' } });

    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ label: 'hello' }));
    });
  });
});

const sensitiveManifest: PluginManifest = {
  ...manifest,
  parameters: [{ name: 'apiKey', label: 'API Key', type: 'string', required: true, sensitive: true }],
};

describe('NodeConfigPanel — sensitive field visibility toggle', () => {
  it('renders a sensitive field masked by default (type="password")', () => {
    render(<NodeConfigPanel manifest={sensitiveManifest} values={{}} onChange={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText(/API Key/)).toHaveAttribute('type', 'password');
  });

  it('reveals the value as plain text when the lock toggle is clicked, and re-masks on a second click', () => {
    render(<NodeConfigPanel manifest={sensitiveManifest} values={{ apiKey: 'secret' }} onChange={vi.fn()} onClose={vi.fn()} />);

    const toggle = screen.getByRole('button', { name: /show value/i });
    fireEvent.click(toggle);
    expect(screen.getByLabelText(/API Key/)).toHaveAttribute('type', 'text');

    fireEvent.click(screen.getByRole('button', { name: /hide value/i }));
    expect(screen.getByLabelText(/API Key/)).toHaveAttribute('type', 'password');
  });

  it('does not submit the form or clear the typed value when the toggle is clicked', () => {
    render(<NodeConfigPanel manifest={sensitiveManifest} values={{ apiKey: 'secret' }} onChange={vi.fn()} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /show value/i }));
    expect(screen.getByLabelText(/API Key/)).toHaveValue('secret');
  });
});

describe('NodeConfigPanel — form never navigates away on Enter', () => {
  it('prevents the default submit behavior (which would otherwise reload the page and lose all app state)', () => {
    render(<NodeConfigPanel manifest={manifest} values={{ label: 'hello' }} onChange={vi.fn()} onClose={vi.fn()} />);

    const form = screen.getByLabelText('Label').closest('form');
    expect(form).not.toBeNull();

    const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
    form!.dispatchEvent(submitEvent);

    expect(submitEvent.defaultPrevented).toBe(true);
  });
});


const jsonManifest: PluginManifest = {
  ...manifest,
  parameters: [{ name: 'conditions', label: 'Conditions', type: 'json', required: true }],
};

describe('NodeConfigPanel — json parameter type, JSON mode (004-core-nodes-catalog, D-06, E002)', () => {
  it('switches to JSON mode via the toggle, showing a textarea pre-filled with pretty-printed JSON', () => {
    render(<NodeConfigPanel manifest={jsonManifest} values={{ conditions: [{ a: 1 }] }} onChange={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
    const field = screen.getByLabelText(/Conditions/);
    expect(field.tagName).toBe('TEXTAREA');
    expect(field).toHaveValue(JSON.stringify([{ a: 1 }], null, 2));
  });

  it('calls onChange with the parsed value once valid JSON is typed', async () => {
    const onChange = vi.fn();
    render(<NodeConfigPanel manifest={jsonManifest} values={{ conditions: [] }} onChange={onChange} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
    const field = screen.getByLabelText(/Conditions/);
    fireEvent.change(field, { target: { value: '{"a": 1}' } });

    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ conditions: { a: 1 } }));
    });
  });

  it('shows an inline error and never calls onChange with the broken raw string when JSON is invalid', async () => {
    const onChange = vi.fn();
    render(<NodeConfigPanel manifest={jsonManifest} values={{ conditions: [] }} onChange={onChange} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
    const field = screen.getByLabelText(/Conditions/);
    fireEvent.change(field, { target: { value: '{not valid' } });

    await vi.waitFor(() => {
      expect(screen.getByText(/invalid json/i)).toBeInTheDocument();
    });
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ conditions: '{not valid' }));
  });

  it('falls back to JSON-only mode (no Fields toggle) for a value that is neither an array-of-objects nor a plain object', () => {
    const scalarManifest: PluginManifest = { ...manifest, parameters: [{ name: 'raw', label: 'Raw', type: 'json', required: false }] };
    render(<NodeConfigPanel manifest={scalarManifest} values={{ raw: 'just a string' }} onChange={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Fields' })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Raw/).tagName).toBe('TEXTAREA');
  });
});

describe('NodeConfigPanel — json parameter type, Fields mode (004-core-nodes-catalog, E002)', () => {
  it('defaults to Fields mode for an array-of-objects value, one input per key', () => {
    render(<NodeConfigPanel manifest={jsonManifest} values={{ conditions: [{ leftValue: 'a' }] }} onChange={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Fields' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Field 1 name')).toHaveValue('leftValue');
    expect(screen.getByLabelText('Field 1 value')).toHaveValue('a');
  });

  it('editing a field value propagates to onChange with the array shape intact', async () => {
    const onChange = vi.fn();
    render(<NodeConfigPanel manifest={jsonManifest} values={{ conditions: [{ leftValue: 'a' }] }} onChange={onChange} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Field 1 value'), { target: { value: '{{ $json.x }}' } });

    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ conditions: [{ leftValue: '{{ $json.x }}' }] }));
    });
  });

  it('"+ Add row" appends an empty object to the array', () => {
    const onChange = vi.fn();
    render(<NodeConfigPanel manifest={jsonManifest} values={{ conditions: [] }} onChange={onChange} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add row' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ conditions: [{}] }));
  });

  it('"+ Add field" adds an empty key to a row', () => {
    const onChange = vi.fn();
    render(<NodeConfigPanel manifest={jsonManifest} values={{ conditions: [{}] }} onChange={onChange} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add field' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ conditions: [{ '': '' }] }));
  });

  it('"Remove row" removes that row from the array', () => {
    const onChange = vi.fn();
    render(<NodeConfigPanel manifest={jsonManifest} values={{ conditions: [{ a: 1 }, { b: 2 }] }} onChange={onChange} onClose={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Remove row 1'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ conditions: [{ b: 2 }] }));
  });

  it('is also available for a plain-object (map) value like headers/body, as a flat key/value list', () => {
    const mapManifest: PluginManifest = { ...manifest, parameters: [{ name: 'headers', label: 'Headers', type: 'json', required: false }] };
    render(<NodeConfigPanel manifest={mapManifest} values={{ headers: { Authorization: 'Bearer x' } }} onChange={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText('Field 1 name')).toHaveValue('Authorization');
    expect(screen.getByLabelText('Field 1 value')).toHaveValue('Bearer x');
  });
});

describe('NodeConfigPanel — live {{ }} expression preview and validity coloring (004-core-nodes-catalog, E003)', () => {
  it('shows no preview and no color for a plain string with no {{ }}', () => {
    render(<NodeConfigPanel manifest={manifest} values={{ label: 'plain text' }} onChange={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByTestId('expression-preview-label')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Label')).not.toHaveClass('!border-emerald-400');
    expect(screen.getByLabelText('Label')).not.toHaveClass('!border-red-400');
  });

  it('turns the field green and shows the resolved value for a valid expression', async () => {
    const testResult = { nodeId: 'n1', input: { name: 'Ada' }, output: null, error: null, startedAt: 't0', finishedAt: 't1' };
    render(<NodeConfigPanel manifest={manifest} values={{ label: '' }} onChange={vi.fn()} onClose={vi.fn()} testResult={testResult} />);
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: '{{ $json.name }}' } });

    await vi.waitFor(() => {
      expect(screen.getByLabelText('Label')).toHaveClass('!border-emerald-400');
    });
    expect(screen.getByTestId('expression-preview-label')).toHaveTextContent('Ada');
  });

  it('turns the field red and shows the error for an invalid expression', async () => {
    render(<NodeConfigPanel manifest={manifest} values={{ label: '' }} onChange={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: '{{ $json.a.b.c }}' } });

    await vi.waitFor(() => {
      expect(screen.getByLabelText('Label')).toHaveClass('!border-red-400');
    });
    expect(screen.getByTestId('expression-preview-label')).toBeInTheDocument();
  });

  it('falls back to an empty $json when the node has never been tested', async () => {
    render(<NodeConfigPanel manifest={manifest} values={{ label: '' }} onChange={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: '{{ 1 + 1 }}' } });

    await vi.waitFor(() => {
      expect(screen.getByTestId('expression-preview-label')).toHaveTextContent('2');
    });
  });
});

describe('NodeConfigPanel — test this node in isolation (003-validation-runtime, RF-02/RF-04)', () => {
  it('does not render the Validation section when onTest is not provided', () => {
    render(<NodeConfigPanel manifest={manifest} values={{ label: '' }} onChange={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /test this node/i })).not.toBeInTheDocument();
  });

  it('calls onTest when the "Test this node" button is clicked', () => {
    const onTest = vi.fn();
    render(<NodeConfigPanel manifest={manifest} values={{ label: '' }} onChange={vi.fn()} onClose={vi.fn()} onTest={onTest} />);
    fireEvent.click(screen.getByRole('button', { name: /test this node/i }));
    expect(onTest).toHaveBeenCalledTimes(1);
  });

  it('disables the test button and shows a busy label while isTesting is true', () => {
    render(<NodeConfigPanel manifest={manifest} values={{ label: '' }} onChange={vi.fn()} onClose={vi.fn()} onTest={vi.fn()} isTesting />);
    expect(screen.getByRole('button', { name: /testing/i })).toBeDisabled();
  });

  it('shows the input and output of the last test result', () => {
    const testResult = { nodeId: 'n1', input: null, output: { ok: true }, error: null, startedAt: 't0', finishedAt: 't1' };
    render(<NodeConfigPanel manifest={manifest} values={{ label: '' }} onChange={vi.fn()} onClose={vi.fn()} onTest={vi.fn()} testResult={testResult} />);
    const result = screen.getByTestId('node-test-result');
    expect(result).toHaveTextContent('null');
    expect(result).toHaveTextContent('"ok": true');
  });

  it('shows the error message instead of output when the last test failed', () => {
    const testResult = { nodeId: 'n1', input: null, output: null, error: 'boom', startedAt: 't0', finishedAt: 't1' };
    render(<NodeConfigPanel manifest={manifest} values={{ label: '' }} onChange={vi.fn()} onClose={vi.fn()} onTest={vi.fn()} testResult={testResult} />);
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
  });
});
