import { normalizeRoutePath, type HttpTrigger } from '../../workflow/triggers.js';

export type HttpRouteMatch =
  | { readonly kind: 'matched'; readonly trigger: HttpTrigger }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'method-not-allowed' };

/**
 * Finds the HTTP trigger a request addresses. Paths compare in normalized form (see
 * normalizeRoutePath) and case-sensitively; an exact method wins over ANY, and HEAD is answered
 * like GET.
 */
export class HttpTriggerRouter {
  private readonly byPath = new Map<string, HttpTrigger[]>();

  constructor(triggers: readonly HttpTrigger[]) {
    for (const trigger of triggers) {
      const path = normalizeRoutePath(trigger.path);
      this.byPath.set(path, [...this.byPath.get(path) ?? [], trigger]);
    }
  }

  match(path: string, method: string): HttpRouteMatch {
    const candidates = this.byPath.get(normalizeRoutePath(path));
    if (!candidates) return { kind: 'not-found' };
    const upper = method.toUpperCase();
    const find = (wanted: string) => candidates.find((candidate) => candidate.method === wanted);
    const trigger = find(upper) ?? (upper === 'HEAD' ? find('GET') : undefined) ?? find('ANY');
    return trigger ? { kind: 'matched', trigger } : { kind: 'method-not-allowed' };
  }
}
