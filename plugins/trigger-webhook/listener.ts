export interface WebhookRequest {
  body?: unknown;
  headers?: unknown;
  query?: unknown;
}

export interface PendingWebhook {
  path: string;
  resolve: (data: WebhookRequest) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function getGlobalPendingWebhooks(): PendingWebhook[] {
  const g = globalThis as typeof globalThis & { __RUNFLUX_PENDING_WEBHOOKS__?: PendingWebhook[] };
  if (!g.__RUNFLUX_PENDING_WEBHOOKS__) {
    g.__RUNFLUX_PENDING_WEBHOOKS__ = [];
  }
  return g.__RUNFLUX_PENDING_WEBHOOKS__;
}

export function pushTestWebhook(targetPath: string, payload: WebhookRequest): boolean {
  const list = getGlobalPendingWebhooks();
  if (list.length === 0) {
    return false;
  }

  const normalize = (path: string) => '/' + path.replace(/^\/+|\/+$/g, '');
  const idx = list.findIndex((pending) => normalize(pending.path) === normalize(targetPath));

  if (idx !== -1) {
    const pending = list.splice(idx, 1)[0];
    clearTimeout(pending.timer);
    pending.resolve(payload);
    return true;
  }

  return false;
}

export function clearPendingWebhooks(): void {
  const list = getGlobalPendingWebhooks();
  while (list.length > 0) {
    const p = list.pop();
    if (p) {
      clearTimeout(p.timer);
      p.reject(new Error('Webhook listener cancelled'));
    }
  }
}

