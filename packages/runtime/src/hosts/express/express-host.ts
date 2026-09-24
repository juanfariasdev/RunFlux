import type { Server } from 'node:http';
import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import type { RunRequest, WorkflowEngine } from '../../engine/workflow-engine.js';
import type { HttpTrigger, WebhookRequest } from '../../workflow/triggers.js';
import { HttpTriggerAuthenticator } from '../http/http-trigger-authenticator.js';
import { HttpTriggerRouter } from '../http/http-trigger-router.js';

export interface ExpressHostOptions {
  /** Reported by `GET /health`. */
  readonly projectName?: string;
  /** Largest accepted request body. Defaults to 1mb. */
  readonly bodyLimit?: string;
  readonly authenticator?: HttpTriggerAuthenticator;
}

/**
 * Serves a workflow over HTTP. Each HTTP trigger gets its own endpoint, routed and authenticated
 * like the Lambda host does; a workflow without HTTP triggers is started with `POST /api/execute`.
 * Every response is JSON and carries the execution result. A client that disconnects cancels its
 * run.
 */
export class ExpressHost {
  readonly app: Express;
  private readonly engine: WorkflowEngine;
  private readonly options: ExpressHostOptions;
  private readonly authenticator: HttpTriggerAuthenticator;
  private server?: Server;

  constructor(engine: WorkflowEngine, options: ExpressHostOptions = {}) {
    this.engine = engine;
    this.options = options;
    this.authenticator = options.authenticator ?? new HttpTriggerAuthenticator();
    this.app = this.createApp();
  }

  listen(port: number): Promise<Server> {
    return new Promise((resolve, reject) => {
      const server = this.app.listen(port, () => resolve(server)).once('error', reject);
      this.server = server;
    });
  }

  /** Stops accepting requests and waits for those in progress. Disposing the engine is up to its owner. */
  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (server) await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }

  private createApp(): Express {
    const { workflow } = this.engine;
    const limit = this.options.bodyLimit ?? '1mb';
    const app = express();
    app.use(cors());
    app.get('/health', (_request, response) => {
      response.json({ status: 'ok', project: this.options.projectName ?? workflow.name, workflowId: workflow.id, nodeCount: workflow.nodes.length });
    });
    if (workflow.triggers.http.length > 0) {
      app.use(this.triggerEndpoints(workflow.triggers.http, limit));
    } else {
      app.post('/api/execute', parseJson(limit), (request, response) => {
        void this.execute(response, { payload: request.body ?? {} });
      });
    }
    app.use((_request: Request, response: Response) => {
      response.status(404).json({ error: 'Not found' });
    });
    app.use((error: Error & { status?: number }, _request: Request, response: Response, _next: NextFunction) => {
      response.status(error.status ?? 500).json({ error: error.message });
    });
    return app;
  }

  private triggerEndpoints(triggers: readonly HttpTrigger[], limit: string): RequestHandler {
    const router = new HttpTriggerRouter(triggers);
    const json = parseJson(limit);
    const text = express.text({ type: () => true, limit });
    return (request, response, next) => {
      const match = router.match(request.path, request.method);
      if (match.kind === 'not-found') return next();
      if (match.kind === 'method-not-allowed') return void response.status(405).json({ error: 'Method not allowed' });
      const { trigger } = match;
      if (!this.authenticator.authorize(trigger, (name) => request.get(name))) return void response.status(401).json({ error: 'Unauthorized' });
      const parse = trigger.rawBody ? text : json;
      parse(request, response, (error?: unknown) => {
        if (error) return next(error);
        const payload: WebhookRequest = { body: request.body, headers: this.authenticator.visibleHeaders(trigger, request.headers), query: request.query };
        void this.execute(response, { payload, triggerId: trigger.nodeId });
      });
    };
  }

  private async execute(response: Response, request: RunRequest): Promise<void> {
    const disconnected = new AbortController();
    response.once('close', () => {
      if (!response.writableFinished) disconnected.abort();
    });
    try {
      const execution = await this.engine.run({ ...request, signal: disconnected.signal });
      if (!response.headersSent) response.status(execution.succeeded ? 200 : 500).json(execution.toResponse());
    } catch (error) {
      if (!response.headersSent) response.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

/** Parses every body as JSON, whatever its content type, like the Lambda host; an empty body is `{}`. */
function parseJson(limit: string): RequestHandler {
  return express.json({ type: () => true, limit });
}
