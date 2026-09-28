import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accessTokenSession, authorizedFetch } from '../../adapters/authorized-fetch';
import { AccessTokenDialog } from '../AccessTokenDialog';

/** The dialog behind the editor's shared `authorizedFetch` (feature 015, RN-14). */
describe('AccessTokenDialog', () => {
  beforeEach(() => {
    accessTokenSession.clear();
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Response('{}', { status: new Headers(init?.headers).get('Authorization') === 'Bearer right' ? 200 : 401 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    accessTokenSession.clear();
  });

  it('asks once for requests refused together, and sends the typed token', async () => {
    render(<AccessTokenDialog />);
    const first = authorizedFetch('/api/projects');
    const second = authorizedFetch('/runflux-plugins.json');

    const field = await screen.findByLabelText('RUNFLUX_API_TOKEN');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect((field as HTMLInputElement).type).toBe('password');
    fireEvent.change(field, { target: { value: 'right' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    });

    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(accessTokenSession.get()).toBe('right');
  });

  it('says so when the server refused the token it held', async () => {
    accessTokenSession.set('wrong');
    render(<AccessTokenDialog />);
    void authorizedFetch('/api/projects').catch(() => {});
    expect(await screen.findByText(/recusou o token/)).toBeInTheDocument();
  });

  it('rejects the request when the developer cancels', async () => {
    render(<AccessTokenDialog />);
    // Caught at once, so the rejection that cancelling causes is never unhandled.
    const outcome = authorizedFetch('/api/projects').catch((error: unknown) => error);
    await screen.findByLabelText('RUNFLUX_API_TOKEN');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    });
    expect(await outcome).toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
  });
});
