import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HttpWebhookTestingAdapter } from '../../adapters/webhook-testing-adapter';
import { Toolbar } from '../Toolbar';

const testWebhooks = new HttpWebhookTestingAdapter();

vi.mock('../../context/ProjectContext', () => ({
  useProject: () => ({
    currentProject: { id: 'p1', name: 'Orders' },
    isDirty: false,
    envVars: [{ key: 'DATABASE_URL', hasValue: true }, { key: 'EMPTY', hasValue: false }],
  }),
}));

describe('Toolbar — project variables in test runs', () => {
  it("runs the workflow with the open project's id, so the server reads its stored values (feature 015, RF-13)", async () => {
    const run = vi.fn().mockResolvedValue({ status: 'success', nodeResults: [] });
    render(
      <Toolbar
        webhooks={testWebhooks}
        catalog={{ listPlugins: async () => ({}), checkReference: async () => ({ status: 'ok' }) }}
        persistence={{ save: vi.fn(), load: vi.fn() }}
        validation={{ run, runToNode: vi.fn(), runNode: vi.fn() }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /test/i }));
    await waitFor(() => expect(run).toHaveBeenCalledWith(expect.anything(), { mode: 'production', projectId: 'p1' }));
  });
});
