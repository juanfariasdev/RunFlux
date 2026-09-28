import { authorizedFetch, bindFetch, type FetchFunction } from './authorized-fetch';
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
  private readonly cancel: FetchFunction;

  /**
   * Cancelling goes through `authorizedFetch`, since an exposed dev server guards it. Test requests
   * use the plain `fetch`: webhook test URLs are open, and the platform token must never reach the
   * waiting trigger's headers (RN-04, audit A003).
   */
  constructor(cancelUrl = '/runflux-webhook-cancel', cancel: FetchFunction = authorizedFetch) {
    this.cancelUrl = cancelUrl;
    this.cancel = bindFetch(cancel);
  }

  async send(request: WebhookTestRequest): Promise<void> {
    await fetch(request.url, request.init).catch(() => {});
  }

  async cancelListeners(): Promise<void> {
    await this.cancel(this.cancelUrl, { method: 'POST' }).catch(() => {});
  }
}
