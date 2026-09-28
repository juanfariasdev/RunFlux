import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessTokenSession, createAuthorizedFetch, type TokenPrompt } from '../authorized-fetch';
import { ProjectApiError } from '../project-api-adapter';

const response = (status: number) => new Response(status === 204 ? null : '{}', { status });
const authorizationOf = (init: RequestInit | undefined) => new Headers(init?.headers).get('Authorization');

/** The editor's one seam for the platform token (feature 015, RN-14, RF-04). */
describe('authorizedFetch', () => {
  let base: ReturnType<typeof vi.fn>;
  let session: AccessTokenSession;
  let prompt: ReturnType<typeof vi.fn> & TokenPrompt;

  beforeEach(() => {
    sessionStorage.clear();
    base = vi.fn();
    session = new AccessTokenSession(sessionStorage);
    prompt = vi.fn() as ReturnType<typeof vi.fn> & TokenPrompt;
  });

  afterEach(() => sessionStorage.clear());

  const authorizedFetch = () => createAuthorizedFetch(session, () => prompt, base as unknown as typeof fetch);

  it('sends no header and asks nothing while the server does not ask for a token', async () => {
    base.mockResolvedValue(response(200));
    const answer = await authorizedFetch()('/api/projects', { method: 'GET' });
    expect(answer.status).toBe(200);
    expect(authorizationOf(base.mock.calls[0][1])).toBeNull();
    expect(prompt).not.toHaveBeenCalled();
  });

  it('asks for the token on a 401, keeps it for the session and retries with it', async () => {
    base.mockResolvedValueOnce(response(401)).mockResolvedValueOnce(response(200)).mockResolvedValueOnce(response(200));
    prompt.mockResolvedValue('the-token');
    const send = authorizedFetch();

    expect((await send('/api/projects', { method: 'PUT', body: '{"a":1}', headers: { 'Content-Type': 'application/json' } })).status).toBe(200);
    expect(prompt).toHaveBeenCalledWith('required');
    const retry = base.mock.calls[1][1] as RequestInit;
    expect(authorizationOf(retry)).toBe('Bearer the-token');
    expect(new Headers(retry.headers).get('Content-Type')).toBe('application/json');
    expect(retry.body).toBe('{"a":1}');
    expect(sessionStorage.getItem('runflux.apiToken')).toBe('the-token');

    await send('/api/projects');
    expect(authorizationOf(base.mock.calls[2][1])).toBe('Bearer the-token');
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('asks again when the token it holds is refused', async () => {
    session.set('old-token');
    base.mockResolvedValueOnce(response(401)).mockResolvedValueOnce(response(401)).mockResolvedValueOnce(response(200));
    prompt.mockResolvedValueOnce('wrong-token').mockResolvedValueOnce('right-token');
    expect((await authorizedFetch()('/runflux-validate', { method: 'POST' })).status).toBe(200);
    expect(prompt.mock.calls).toEqual([['rejected'], ['rejected']]);
    expect(base.mock.calls.map(([, init]) => authorizationOf(init))).toEqual(['Bearer old-token', 'Bearer wrong-token', 'Bearer right-token']);
    expect(session.get()).toBe('right-token');
  });

  it('throws an UNAUTHORIZED ProjectApiError when the prompt is cancelled, and forgets the refused token', async () => {
    session.set('refused');
    base.mockResolvedValue(response(401));
    prompt.mockResolvedValue(null);
    const error = await authorizedFetch()('/api/projects').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProjectApiError);
    expect(error).toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    expect(session.get()).toBeUndefined();
  });

  it('hands the 401 back when no prompt is available', async () => {
    base.mockResolvedValue(response(401));
    const answer = await createAuthorizedFetch(session, () => undefined, base as unknown as typeof fetch)('/api/projects');
    expect(answer.status).toBe(401);
  });

  it('keeps working when the browser storage throws', async () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } } as unknown as Storage;
    const fragile = new AccessTokenSession(broken);
    fragile.set('kept-in-memory');
    expect(fragile.get()).toBe('kept-in-memory');
  });
});
