import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
