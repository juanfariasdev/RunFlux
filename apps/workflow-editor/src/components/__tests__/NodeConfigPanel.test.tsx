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
