import { ProjectApiError } from './api-error';

export type FetchFunction = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Asks the developer for the platform token: `required` the first time, `rejected` after the
 * server refused the one held. Resolves to null when the developer cancels.
 */
export type TokenPrompt = (reason: 'required' | 'rejected') => Promise<string | null>;

const STORAGE_KEY = 'runflux.apiToken';

/**
 * The platform token for this browser session (RN-14): kept in `sessionStorage`, so closing the
 * browser forgets it, and in memory when the storage is unavailable.
 */
export class AccessTokenSession {
  private memory: string | undefined;
  private readonly storage: Storage | undefined;

  constructor(storage: Storage | undefined = safeSessionStorage()) {
    this.storage = storage;
  }

  get(): string | undefined {
    try {
      return this.storage?.getItem(STORAGE_KEY) ?? this.memory;
    } catch {
      return this.memory;
    }
  }

  set(token: string): void {
    this.memory = token;
    try {
      this.storage?.setItem(STORAGE_KEY, token);
    } catch {
      // The token stays in memory for this page.
    }
  }

  clear(): void {
    this.memory = undefined;
    try {
      this.storage?.removeItem(STORAGE_KEY);
    } catch {
      // Nothing was stored.
    }
  }
}

/** `send` as a fetch that passes `init` on only when there is one, and never as a method of its holder. */
export function bindFetch(send: FetchFunction): FetchFunction {
  return (input, init) => (init === undefined ? send(input) : send(input, init));
}

/** The browser's fetch, read on every call so a test can replace it. */
const globalFetch: FetchFunction = (input, init) => (init === undefined ? globalThis.fetch(input) : globalThis.fetch(input, init));

/**
 * A fetch that sends the session's token and, on a 401, asks for one and tries again until the
 * server accepts it or the developer cancels. Without a prompt, the 401 is handed back.
 */
export function createAuthorizedFetch(session: AccessTokenSession, prompt: () => TokenPrompt | undefined, send: FetchFunction = globalFetch): FetchFunction {
  return async (input, init) => {
    let token = session.get();
    let response = await send(input, withToken(init, token));
    while (response.status === 401) {
      const ask = prompt();
      if (!ask) return response;
      const typed = await ask(token === undefined ? 'required' : 'rejected');
      if (!typed) {
        session.clear();
        throw new ProjectApiError(401, 'UNAUTHORIZED', 'Authentication required');
      }
      token = typed;
      session.set(token);
      response = await send(input, withToken(init, token));
    }
    return response;
  };
}

function withToken(init: RequestInit | undefined, token: string | undefined): RequestInit | undefined {
  if (token === undefined) return init;
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return { ...init, headers };
}

function safeSessionStorage(): Storage | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}

let tokenPrompt: TokenPrompt | undefined;

/** Registers the dialog that asks for the token; `AccessTokenDialog` does it while mounted. */
export function setTokenPrompt(prompt: TokenPrompt | undefined): void {
  tokenPrompt = prompt;
}

/** The session every adapter of the editor shares. */
export const accessTokenSession = new AccessTokenSession();

/** The fetch every HTTP adapter of the editor uses by default (D-14). */
export const authorizedFetch: FetchFunction = createAuthorizedFetch(accessTokenSession, () => tokenPrompt);
