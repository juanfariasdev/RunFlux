import { normalizeRoutePath, type TriggerEventSource } from '@runflux/runtime';

/** A request sent to a webhook's test URL while the editor waits for it. */
export interface WebhookTestRequest {
  body?: unknown;
  headers?: unknown;
  query?: unknown;
  method?: string;
}

interface Waiter {
  readonly path: string;
  readonly resolve: (request: WebhookTestRequest) => void;
  readonly reject: (error: Error) => void;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const SHARED_HUB = Symbol.for('runflux.webhook-test-hub');

/**
 * Hands test requests to the webhook triggers waiting for them while the editor runs a workflow.
 * Each request goes to the oldest waiter on its path; a waiter gives up after a timeout, when its
 * run no longer needs it, or when the user cancels every wait.
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

  waitFor(path: string, signal: AbortSignal): Promise<WebhookTestRequest> {
    const normalized = normalizeRoutePath(path);
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new Error('Cancelled: another trigger in this test run already fired'));
      const settle = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        const index = this.waiters.indexOf(waiter);
        if (index !== -1) this.waiters.splice(index, 1);
      };
      const waiter: Waiter = {
        path: normalized,
        resolve: (request) => { settle(); resolve(request); },
        reject: (error) => { settle(); reject(error); },
      };
      const onAbort = () => waiter.reject(new Error('Cancelled: another trigger in this test run already fired'));
      const timer = setTimeout(() => waiter.reject(new Error(
        `Timeout waiting for incoming webhook request on "${normalized}" after ${this.timeoutMs / 1000}s. Send an HTTP request to the test URL and click Test again.`,
      )), this.timeoutMs);
      signal.addEventListener('abort', onAbort);
      this.waiters.push(waiter);
    });
  }

  /** Delivers `request` to the oldest waiter on `path`. Returns whether one was waiting. */
  deliver(path: string, request: WebhookTestRequest): boolean {
    const waiter = this.waiters.find((candidate) => candidate.path === normalizeRoutePath(path));
    waiter?.resolve(request);
    return waiter !== undefined;
  }

  /** Rejects every waiter, e.g. when the user cancels a test. */
  cancelAll(): void {
    for (const waiter of [...this.waiters]) waiter.reject(new Error('Webhook listener cancelled'));
  }
}
