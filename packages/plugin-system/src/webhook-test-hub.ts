import { normalizeRoutePath, parseWebhookChannel, type TriggerEventSource, type WebhookRoute } from '@runflux/runtime';

/** A request sent to a webhook's test URL while the editor waits for it. */
export interface WebhookTestRequest {
  body?: unknown;
  headers?: unknown;
  query?: unknown;
  method?: string;
}

interface Waiter {
  readonly route: WebhookRoute;
  readonly resolve: (request: WebhookTestRequest) => void;
  readonly reject: (error: Error) => void;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const SHARED_HUB = Symbol.for('runflux.webhook-test-hub');
const CANCELLED = 'Cancelled: another trigger in this test run already fired';

/**
 * Hands test requests to the webhook triggers waiting for them while the editor runs a workflow.
 * Triggers wait on their route (`POST /orders`); a request goes to the oldest waiter of its path
 * and method, as the exported backends route it: an exact method before `ANY`, and HEAD like GET.
 * A request without a method reaches any waiter of its path. A waiter gives up after a timeout,
 * when its run no longer needs it, or when the user cancels every wait.
 */
export class WebhookTestHub implements TriggerEventSource {
  private readonly waiters: Waiter[] = [];
  private readonly timeoutMs: number;

  constructor(timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
  }

  /**
   * The hub of this process. It lives on `globalThis` so the editor's server and the plugins it
   * loads share it even when each bundled its own copy of this module.
   */
  static shared(): WebhookTestHub {
    const host = globalThis as typeof globalThis & { [SHARED_HUB]?: WebhookTestHub };
    return (host[SHARED_HUB] ??= new WebhookTestHub());
  }

  get pending(): number {
    return this.waiters.length;
  }

  /** Waits for a request on `channel`: a route such as `POST /orders`, or a bare path. */
  waitFor(channel: string, signal: AbortSignal): Promise<WebhookTestRequest> {
    const route = parseWebhookChannel(channel);
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new Error(CANCELLED));
      const settle = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        const index = this.waiters.indexOf(waiter);
        if (index !== -1) this.waiters.splice(index, 1);
      };
      const waiter: Waiter = {
        route,
        resolve: (request) => { settle(); resolve(request); },
        reject: (error) => { settle(); reject(error); },
      };
      const onAbort = () => waiter.reject(new Error(CANCELLED));
      const timer = setTimeout(() => waiter.reject(new Error(
        `Timeout waiting for incoming webhook request on "${route.path}" after ${this.timeoutMs / 1000}s. Send an HTTP request to the test URL and click Test again.`,
      )), this.timeoutMs);
      signal.addEventListener('abort', onAbort);
      this.waiters.push(waiter);
    });
  }

  /** Delivers `request` to the waiter its path and method reach. Returns whether one was waiting. */
  deliver(path: string, request: WebhookTestRequest): boolean {
    const route = normalizeRoutePath(path);
    const method = request.method?.toUpperCase();
    const onPath = this.waiters.filter((waiter) => waiter.route.path === route);
    const waiter = method === undefined
      ? onPath[0]
      : onPath.find((candidate) => candidate.route.method === method || (method === 'HEAD' && candidate.route.method === 'GET'))
        ?? onPath.find((candidate) => candidate.route.method === 'ANY');
    waiter?.resolve(request);
    return waiter !== undefined;
  }

  /** Rejects every waiter, e.g. when the user cancels a test. */
  cancelAll(): void {
    for (const waiter of [...this.waiters]) waiter.reject(new Error('Webhook listener cancelled'));
  }
}
