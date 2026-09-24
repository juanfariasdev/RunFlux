import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface UpstreamRequest {
  readonly method: string;
  readonly path: string;
  readonly query: Record<string, string>;
  readonly body: unknown;
  readonly forwardedBy: string | null;
}

/**
 * The third-party API the HTTP example calls. It answers every request with a JSON description of
 * it, except `/fail`, which answers 503.
 */
export class UpstreamServer {
  readonly requests: UpstreamRequest[] = [];
  private readonly server: http.Server;

  private constructor(server: http.Server) {
    this.server = server;
  }

  static async start(): Promise<UpstreamServer> {
    const upstream = new UpstreamServer(http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const url = new URL(request.url ?? '/', 'http://upstream');
        const text = Buffer.concat(chunks).toString('utf8');
        const described: UpstreamRequest = {
          method: request.method ?? 'GET',
          path: url.pathname,
          query: Object.fromEntries(url.searchParams),
          body: text ? JSON.parse(text) : null,
          forwardedBy: (request.headers['x-forwarded-by'] as string | undefined) ?? null,
        };
        upstream.requests.push(described);
        if (url.pathname === '/fail') {
          response.writeHead(503, { 'Content-Type': 'text/plain' }).end('upstream unavailable');
          return;
        }
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(described));
      });
    }));
    await new Promise<void>((resolve) => upstream.server.listen(0, '127.0.0.1', resolve));
    return upstream;
  }

  get url(): string {
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop(): Promise<void> {
    this.server.closeAllConnections();
    return new Promise((resolve, reject) => this.server.close((error) => (error ? reject(error) : resolve())));
  }
}
