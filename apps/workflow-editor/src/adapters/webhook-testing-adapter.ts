import type { WebhookTestRequest } from './webhook-test-request';

/**
 * Seam to the webhook test endpoints of the editor's server: sending a request to a webhook
 * trigger waiting in a test run, and stopping every wait.
 */
export interface WebhookTestingAdapter {
  /** Sends a request built by webhookTestRequest. Failures are ignored: the waiting run reports them. */
  send(request: WebhookTestRequest): Promise<void>;
  /** Stops every webhook trigger waiting in a test run. */
  cancelListeners(): Promise<void>;
}

export class HttpWebhookTestingAdapter implements WebhookTestingAdapter {
  private readonly cancelUrl: string;

  constructor(cancelUrl = '/runflux-webhook-cancel') {
    this.cancelUrl = cancelUrl;
  }

  async send(request: WebhookTestRequest): Promise<void> {
    await fetch(request.url, request.init).catch(() => {});
  }

  async cancelListeners(): Promise<void> {
    await fetch(this.cancelUrl, { method: 'POST' }).catch(() => {});
  }
}
