import type { HttpTrigger } from '../../workflow/triggers.js';

export type HttpRouteMatch =
  | { readonly kind: 'matched'; readonly trigger: HttpTrigger }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'method-not-allowed' };

/** Finds the HTTP trigger a request addresses. Paths match exactly, ignoring a trailing slash. */
export class HttpTriggerRouter {
  private readonly byPath = new Map<string, HttpTrigger[]>();

  constructor(triggers: readonly HttpTrigger[]) {
    for (const trigger of triggers) {
      const path = normalizePath(trigger.path);
      this.byPath.set(path, [...this.byPath.get(path) ?? [], trigger]);
    }
  }

  match(path: string, method: string): HttpRouteMatch {
    const candidates = this.byPath.get(normalizePath(path));
    if (!candidates) return { kind: 'not-found' };
    const upper = method.toUpperCase();
    const trigger = candidates.find((candidate) => candidate.method === upper)
      ?? candidates.find((candidate) => candidate.method === 'ANY');
    return trigger ? { kind: 'matched', trigger } : { kind: 'method-not-allowed' };
  }
}

function normalizePath(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}
