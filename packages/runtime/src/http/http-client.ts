export type HttpTransport = (url: string, init: RequestInit) => Promise<Response>;

export interface HttpRequest {
  readonly method: string;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** Sent as JSON unless the method is GET or HEAD. Undefined sends no body. */
  readonly body?: unknown;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  /** Parsed when the response declares JSON, raw text otherwise. */
  readonly body: unknown;
}

export class HttpRequestError extends Error {
  readonly url: string;
  readonly status: number;

  constructor(
    url: string,
    status: number,
    responseText: string,
  ) {
    super(`request to ${url} failed with status ${status}: ${responseText.slice(0, 200)}`);
    this.name = 'HttpRequestError';
    this.url = url;
    this.status = status;
  }
}

const BODYLESS_METHODS = new Set(['GET', 'HEAD']);

export class HttpClient {
  /** The default transport reads `fetch` on every call, so replacing the global takes effect. */
  private readonly transport: HttpTransport;

  constructor(transport: HttpTransport = (url, init) => globalThis.fetch(url, init)) {
    this.transport = transport;
  }

  async send(request: HttpRequest): Promise<HttpResponse> {
    const response = await this.transport(request.url, this.createInit(request));
    const text = await response.text();
    if (!response.ok) throw new HttpRequestError(request.url, response.status, text);
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return { status: response.status, headers, body: parseBody(text, response.headers.get('content-type')) };
  }

  private createInit(request: HttpRequest): RequestInit {
    const method = request.method.toUpperCase();
    const headers: Record<string, string> = { ...request.headers };
    if (BODYLESS_METHODS.has(method) || request.body === undefined) return { method, headers };
    if (!Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
    return { method, headers, body: JSON.stringify(request.body) };
  }
}

function parseBody(text: string, contentType: string | null): unknown {
  if (!contentType?.includes('application/json')) return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
