import type { ChildProcess } from 'node:child_process';
import request from 'supertest';
import { expect, vi } from 'vitest';
import type { PluginRegistry } from '@runflux/plugin-system/plugin-registry';
import { WebhookTestHub } from '@runflux/plugin-system/webhook-test-hub';
import { runWorkflow } from '@runflux/validation-runtime';
import type { WorkflowDefinition } from '@runflux/workflow-model';
import type { ExportedProject } from './exported-project';

/** One HTTP request to a workflow backend. `path` may carry a query string. */
export interface ExampleRequest {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** Sent as JSON. */
  readonly body?: unknown;
  /** Sent as is, with the content type in `headers` or text/plain. */
  readonly text?: string;
}

/** The HTTP status and the JSON body: `{ success, result, nodeOutputs, error }` or `{ error }`. */
export interface ExampleResponse {
  readonly status: number;
  readonly body: any;
}

/** A way to reach a workflow: the editor's test run or one of its exported backends. */
export interface BackendClient {
  readonly name: string;
  /**
   * Whether the client routes, authenticates and parses requests as an HTTP backend. The editor's
   * test runs do not: they hand the request to the waiting trigger.
   */
  readonly http: boolean;
  send(request: ExampleRequest): Promise<ExampleResponse>;
  close(): Promise<void>;
}

const SILENT = { info: () => {}, error: () => {} };

function split(path: string): { pathname: string; query: Record<string, string> } {
  const url = new URL(path, 'http://backend');
  return { pathname: url.pathname, query: Object.fromEntries(url.searchParams) };
}

function lowerCased(headers: Readonly<Record<string, string>> = {}): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
}

/** The request headers, lower-cased, with the content type of its body unless it sets one. */
function headersOf(example: ExampleRequest): Record<string, string> {
  return { ...contentType(example), ...lowerCased(example.headers) };
}

function contentType(example: ExampleRequest): Record<string, string> {
  if (example.text !== undefined) return { 'content-type': 'text/plain' };
  return example.body === undefined ? {} : { 'content-type': 'application/json' };
}

/**
 * The editor's "Test" of the whole workflow: every trigger starts, webhooks wait on the test hub,
 * and the request is delivered to the one its method and path reach, like a curl to the test URL.
 * The response describes that trigger's flow, serialized as the editor receives it.
 */
export class EditorClient implements BackendClient {
  readonly name = 'editor test run';
  readonly http = false;
  private readonly workflow: WorkflowDefinition;
  private readonly registry: PluginRegistry;
  private readonly environment: Readonly<Record<string, string>>;

  /** `environment` holds the project variables the editor sends with each test run. */
  constructor(workflow: WorkflowDefinition, registry: PluginRegistry, environment: Readonly<Record<string, string>> = {}) {
    this.workflow = workflow;
    this.registry = registry;
    this.environment = environment;
  }

  async send(example: ExampleRequest): Promise<ExampleResponse> {
    const hub = new WebhookTestHub(10_000);
    const webhooks = new Set(this.workflow.nodes.filter((node) => node.pluginId === 'trigger-webhook').map((node) => node.id));
    const running = runWorkflow(this.workflow, this.registry, {
      mode: 'production',
      services: { triggerEvents: hub, logger: SILENT },
      // As the editor's dev server does: the project variables before the process environment.
      environment: { ...process.env, ...this.environment },
    });
    await vi.waitFor(() => expect(hub.pending).toBe(webhooks.size), { timeout: 5_000 });
    const { pathname, query } = split(example.path);
    const delivered = hub.deliver(pathname, {
      method: example.method,
      body: example.text ?? example.body ?? {},
      headers: headersOf(example),
      query,
    });
    if (!delivered) {
      hub.cancelAll();
      await running;
      return { status: 404, body: { error: 'Not found' } };
    }
    const run = await running;
    const trigger = run.nodeResults.find((result) => webhooks.has(result.nodeId) && result.error === null)!;
    const flow = descendants(this.workflow, trigger.nodeId);
    const results = run.nodeResults.filter((result) => flow.has(result.nodeId));
    const failure = results.find((result) => result.error !== null);
    const nodeOutputs = Object.fromEntries(results.filter((result) => result.error === null).map((result) => [result.nodeId, result.output]));
    const body = failure ? { success: false, nodeOutputs, error: failure.error } : { success: true, nodeOutputs };
    return { status: failure ? 500 : 200, body: JSON.parse(JSON.stringify(body)) };
  }

  async close(): Promise<void> {}
}

/** A trigger and every node downstream of it. */
function descendants(workflow: WorkflowDefinition, start: string): Set<string> {
  const reached = new Set([start]);
  for (const id of reached) {
    for (const connection of workflow.connections) if (connection.sourceNodeId === id) reached.add(connection.targetNodeId);
  }
  return reached;
}

interface Execution {
  readonly records: ReadonlyArray<{ nodeId: string }>;
  toResponse(): any;
}

type Engine = { run(request: unknown): Promise<Execution>; dispose(): Promise<void> };

/** The exported local backend's Express app, composed in-process from its vendored runtime. */
export class ExpressClient implements BackendClient {
  readonly name = 'exported Express app';
  readonly http = true;
  /** Nodes some request or schedule of this client ran, to check that tests reach all of them. */
  readonly executed = new Set<string>();
  /** The execution of the latest run, e.g. of a schedule fired through the engine. */
  lastExecution?: Execution;
  readonly engine: Engine;
  private readonly app: Parameters<typeof request>[0];

  private constructor(engine: Engine, app: Parameters<typeof request>[0]) {
    this.engine = engine;
    this.app = app;
    const run = engine.run.bind(engine);
    engine.run = async (runRequest) => {
      const execution = await run(runRequest);
      for (const record of execution.records) this.executed.add(record.nodeId);
      this.lastExecution = execution;
      return execution;
    };
  }

  static async create(project: ExportedProject): Promise<ExpressClient> {
    const { ExpressHost } = await project.runtime('express');
    const engine = await project.engine({ services: { logger: SILENT } });
    return new ExpressClient(engine, new ExpressHost(engine).app);
  }

  async send(example: ExampleRequest): Promise<ExampleResponse> {
    // supertest listens on a new ephemeral port per request; without keep-alive, a pooled socket
    // to a port the OS hands out again can never be reused against a closed server.
    let call = request(this.app)[example.method.toLowerCase() as 'get'](example.path).set('Connection', 'close');
    for (const [name, value] of Object.entries(headersOf(example))) call = call.set(name, value);
    const response = await (example.text !== undefined ? call.send(example.text) : example.body !== undefined ? call.send(example.body as object) : call);
    return { status: response.status, body: response.body };
  }

  /** Releases what the nodes hold, such as database pools, as the server does on shutdown. */
  close(): Promise<void> {
    return this.engine.dispose();
  }
}

/** The exported local backend as users run it: `node dist/server.mjs`, reached over TCP. */
export class ServerProcessClient implements BackendClient {
  readonly name = 'exported server process';
  readonly http = true;
  private readonly child: ChildProcess;
  private readonly baseUrl: string;

  private constructor(child: ChildProcess, baseUrl: string) {
    this.child = child;
    this.baseUrl = baseUrl;
  }

  static async start(project: ExportedProject, env: Record<string, string>): Promise<ServerProcessClient> {
    const { child, ready } = await project.start('dist/server.mjs', { ...env, PORT: '0' }, /Listening on port (\d+)/);
    return new ServerProcessClient(child, `http://127.0.0.1:${ready[1]}`);
  }

  async send(example: ExampleRequest): Promise<ExampleResponse> {
    const response = await fetch(`${this.baseUrl}${example.path}`, {
      method: example.method,
      headers: headersOf(example),
      body: example.text ?? (example.body === undefined ? undefined : JSON.stringify(example.body)),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  /** Stops the server like a container runtime would, expecting a clean exit. */
  async close(): Promise<void> {
    if (this.child.exitCode !== null) return;
    const exited = new Promise<number | null>((resolve) => this.child.once('exit', resolve));
    this.child.kill('SIGTERM');
    expect(await exited).toBe(0);
  }
}

type LambdaHandler = (event: object) => Promise<{ statusCode: number; body: string }>;

/** The exported AWS backend's bundled Lambda handler, invoked with function URL events. */
export class LambdaClient implements BackendClient {
  readonly name = 'exported Lambda handler';
  readonly http = true;
  readonly handler: LambdaHandler;

  private constructor(handler: LambdaHandler) {
    this.handler = handler;
  }

  static async create(project: ExportedProject): Promise<LambdaClient> {
    return new LambdaClient((await project.import<{ handler: LambdaHandler }>('dist/handler.mjs')).handler);
  }

  async send(example: ExampleRequest): Promise<ExampleResponse> {
    const { pathname, query } = split(example.path);
    const response = await this.handler({
      rawPath: pathname,
      requestContext: { http: { method: example.method } },
      headers: headersOf(example),
      queryStringParameters: query,
      body: example.text ?? (example.body === undefined ? undefined : JSON.stringify(example.body)),
      isBase64Encoded: false,
    });
    return { status: response.statusCode, body: JSON.parse(response.body) };
  }

  /** The invocation an EventBridge schedule of the exported stack sends. */
  async schedule(triggerId: string): Promise<ExampleResponse> {
    const response = await this.handler({ runfluxTriggerId: triggerId });
    return { status: response.statusCode, body: JSON.parse(response.body) };
  }

  async close(): Promise<void> {}
}
