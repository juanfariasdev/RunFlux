import type { Server } from 'node:http';
import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import type { WorkflowEngine } from '../../engine/workflow-engine.js';
import type { WorkflowExecution } from '../../engine/workflow-execution.js';
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
 * Serves a workflow over HTTP. Each HTTP trigger gets its own endpoint; a workflow without HTTP
 * triggers is started with `POST /api/execute` instead. Every response carries the execution result.
 */
export class ExpressHost {
  readonly app: Express;
  private server?: Server;

  constructor(
    private readonly engine: WorkflowEngine,
    private readonly options: ExpressHostOptions = {},
  ) {
    this.app = this.createApp();
  }

  listen(port: number): Promise<Server> {
    return new Promise((resolve, reject) => {
      const server = this.app.listen(port, () => resolve(server)).once('error', reject);
      this.server = server;
    });
  }

  /** Stops accepting requests and releases the engine's resources. */
  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (server) await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await this.engine.dispose();
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
      app.post('/api/execute', express.json({ limit }), (request, response) => {
        void this.respond(response, this.engine.run({ payload: request.body ?? {} }));
      });
    }
    app.use((error: Error & { status?: number }, _request: Request, response: Response, _next: NextFunction) => {
      response.status(error.status ?? 500).json({ error: error.message });
    });
    return app;
  }

  private triggerEndpoints(triggers: readonly HttpTrigger[], limit: string): RequestHandler {
    const router = new HttpTriggerRouter(triggers);
    const authenticator = this.options.authenticator ?? new HttpTriggerAuthenticator();
    const parseJson = express.json({ limit });
    const parseText = express.text({ type: '*/*', limit });
    return (request, response, next) => {
      const match = router.match(request.path, request.method);
      if (match.kind === 'not-found') return next();
      if (match.kind === 'method-not-allowed') return void response.status(405).json({ error: 'Method not allowed' });
      const { trigger } = match;
      if (!authenticator.authorize(trigger, (name) => request.get(name))) return void response.status(401).json({ error: 'Unauthorized' });
      const parse = trigger.rawBody ? parseText : parseJson;
      parse(request, response, (error?: unknown) => {
        if (error) return next(error);
        const payload: WebhookRequest = { body: request.body, headers: request.headers, query: request.query };
        void this.respond(response, this.engine.run({ payload, triggerId: trigger.nodeId }));
      });
    };
  }

  private async respond(response: Response, execution: Promise<WorkflowExecution>): Promise<void> {
    try {
      const result = await execution;
      response.status(result.succeeded ? 200 : 500).json(result.toResponse());
    } catch (error) {
      response.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
}
