import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HttpWebhookTestingAdapter } from '../../adapters/webhook-testing-adapter';
import { Toolbar } from '../Toolbar';

const testWebhooks = new HttpWebhookTestingAdapter();

vi.mock('../../context/ProjectContext', () => ({
  useProject: () => ({
    currentProject: null,
    isDirty: false,
    envVars: [{ key: 'DATABASE_URL', value: 'postgres://localhost/runflux' }, { key: 'EMPTY', value: '' }],
  }),
}));

describe('Toolbar — project variables in test runs', () => {
  it('runs the workflow with the variables of the open project as its environment', async () => {
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
    await waitFor(() => expect(run).toHaveBeenCalledWith(expect.anything(), { mode: 'production', environment: { DATABASE_URL: 'postgres://localhost/runflux', EMPTY: '' } }));
  });
});
