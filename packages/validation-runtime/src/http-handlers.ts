import type { IncomingMessage, ServerResponse } from 'node:http';
import type { EnvironmentVariables, TriggerEventSource, WorkflowSource } from '@runflux/runtime';
import { runNode, runWorkflow, runWorkflowToNode, type NodeResult, type PluginExecutionMode, type ValidationCatalog } from './engine.js';

/** Body of a validation request. */
interface ValidationRequest {
  workflow: WorkflowSource;
  /** Runs only this node, with `cachedResults` of nodes tested earlier as upstream data. */
  nodeId?: string;
  /** Runs the real workflow path up to and including this node. */
  untilNodeId?: string;
  mode: PluginExecutionMode;
  cachedResults?: NodeResult[];
  /** The project whose stored values test runs read as `$env`, through `projectEnvironment`. */
  projectId?: string;
  /** Variables read as `$env` above everything else; for callers other than the editor, such as tests. */
  environment?: Record<string, string>;
}

/** What the handlers need from the webhook test hub: triggers wait on it and requests reach them through it. */
export interface WebhookDelivery extends TriggerEventSource {
  deliver(path: string, request: { body?: unknown; headers?: unknown; query?: unknown; method?: string }): boolean;
  cancelAll(): void;
}

/** The stored values of a project, and the names whose value cannot be decrypted. */
export interface ProjectEnvironmentValues {
  readonly values: Readonly<Record<string, string>>;
  readonly unreadable?: readonly string[];
}

export interface ValidationHttpOptions {
  /** The plugins test runs execute; asked on every run, so a catalog that rediscovers edited plugins is honored. */
  readonly catalog: () => Promise<ValidationCatalog>;
  readonly webhooks: WebhookDelivery;
  /** `$env` under the project's values. Defaults to the server process environment without the platform's secrets. */
  readonly environment?: () => EnvironmentVariables;
  /** Gives the stored values of the project a request names; asked on every run, so a value saved a moment ago is used. */
  readonly projectEnvironment?: (projectId: string, signal: AbortSignal) => Promise<ProjectEnvironmentValues>;
  /** Whether a request may run tests or cancel them. Webhook test requests are never asked (RN-14). */
  readonly authorize?: (request: IncomingMessage) => boolean;
  /** Largest request body, in bytes. Defaults to 5 MB. */
  readonly maxBodyBytes?: number;
}

/** The test execution endpoints of the editor, over plain `node:http` requests so any server can mount them. */
export interface ValidationHttpHandlers {
  /** `POST`: runs a workflow, the path to a node or one node. A client that disconnects cancels its run. */
  validate(request: IncomingMessage, response: ServerResponse): void;
  /** Hands a request sent to a webhook test URL to the trigger waiting on its path. False when the URL is not one. */
  deliverWebhook(request: IncomingMessage, response: ServerResponse): boolean;
  /** Stops every waiting webhook trigger. */
  cancelWebhooks(request: IncomingMessage, response: ServerResponse): void;
}

/** Variables of the platform itself, which no test run may read (RN-04). */
export const PLATFORM_SECRET_VARIABLES: readonly string[] = ['RUNFLUX_API_TOKEN', 'RUNFLUX_SECRET_KEY'];

const WEBHOOK_TEST_PREFIXES = ['/runflux-webhook-test', '/api/webhooks/test'];
const DEFAULT_WEBHOOK_PATH = '/webhook';
const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024;
const AUTHENTICATION_REQUIRED = { error: 'Authentication required' };

class BadRequestError extends Error {}
class PayloadTooLargeError extends Error {}

export function createValidationHttpHandlers(options: ValidationHttpOptions): ValidationHttpHandlers {
  const { webhooks, authorize } = options;
  const environment = options.environment ?? (() => withoutPlatformSecrets(process.env));
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  return {
    validate(request, response) {
      if (request.method !== 'POST') return sendJson(response, 405, { error: 'method not allowed, use POST' });
      if (authorize && !authorize(request)) return sendJson(response, 401, AUTHENTICATION_REQUIRED);
      const cancellation = new AbortController();
      response.once('close', () => {
        if (!response.writableFinished) cancellation.abort();
      });
      respond(response, async () => {
        const payload = parseJson<ValidationRequest>(await readBody(request, maxBodyBytes));
        const project = payload.projectId && options.projectEnvironment ? await options.projectEnvironment(payload.projectId, cancellation.signal) : undefined;
        const catalog = await options.catalog();
        const runOptions = {
          mode: payload.mode,
          services: { triggerEvents: webhooks },
          signal: cancellation.signal,
          environment: layeredEnvironment(environment(), project, textValues(payload.environment)),
        };
        if (payload.untilNodeId) return runWorkflowToNode(payload.workflow, payload.untilNodeId, catalog, runOptions);
        if (!payload.nodeId) return runWorkflow(payload.workflow, catalog, runOptions);
        const cache = new Map((payload.cachedResults ?? []).map((result) => [result.nodeId, result]));
        return runNode(payload.workflow, payload.nodeId, catalog, runOptions, cache);
      });
    },

    deliverWebhook(request, response) {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const prefix = WEBHOOK_TEST_PREFIXES.find((candidate) => url.pathname === candidate || url.pathname.startsWith(`${candidate}/`));
      if (!prefix) return false;
      respond(response, async () => {
        const body = parseLenient(await readBody(request, maxBodyBytes));
        const path = url.pathname.slice(prefix.length) || DEFAULT_WEBHOOK_PATH;
        const captured = webhooks.deliver(path, {
          body,
          headers: visibleHeaders(request, authorize),
          query: Object.fromEntries(url.searchParams),
          method: request.method ?? 'POST',
        });
        return {
          success: true,
          captured,
          message: captured
            ? 'Webhook captured! The waiting test in RunFlux has completed.'
            : `Webhook payload received, but no webhook of a running test waits for ${request.method ?? 'POST'} ${path}. Click "Test" or "Test this node" in the editor first, and send the method the webhook answers.`,
          data: body,
        };
      });
      return true;
    },

    cancelWebhooks(request, response) {
      if (authorize && !authorize(request)) return sendJson(response, 401, AUTHENTICATION_REQUIRED);
      webhooks.cancelAll();
      sendJson(response, 200, { success: true, message: 'Listening cancelled' });
    },
  };
}

/** `environment` without the platform's own secrets. */
export function withoutPlatformSecrets(environment: EnvironmentVariables): Record<string, string | undefined> {
  const visible: Record<string, string | undefined> = { ...environment };
  for (const name of PLATFORM_SECRET_VARIABLES) delete visible[name];
  return visible;
}

/**
 * `$env` of a run: the process environment, under the project's values, under the request's own.
 * A project value that cannot be decrypted is never replaced by the process variable of the same
 * name; reading it fails the node that reads it, naming the variable (RN-09). The engine hands the
 * object to nodes by reference, so a run that never reads the name is not affected.
 */
function layeredEnvironment(base: EnvironmentVariables, project: ProjectEnvironmentValues | undefined, request: Record<string, string>): EnvironmentVariables {
  const merged: Record<string, string | undefined> = { ...base, ...project?.values };
  const unreadable = (project?.unreadable ?? []).filter((name) => request[name] === undefined);
  for (const name of unreadable) delete merged[name];
  Object.assign(merged, request);
  if (unreadable.length === 0) return merged;
  const names = new Set(unreadable);
  return new Proxy(merged, {
    get(target, property, receiver) {
      if (typeof property === 'string' && names.has(property)) throw new Error(`Variable "${property}" cannot be decrypted; set its value again`);
      return Reflect.get(target, property, receiver);
    },
  });
}

/** The request headers a waiting trigger sees: without an `Authorization` header that carries the platform credential. */
function visibleHeaders(request: IncomingMessage, authorize: ValidationHttpOptions['authorize']): IncomingMessage['headers'] {
  if (!authorize || request.headers.authorization === undefined || !authorize(request)) return request.headers;
  const { authorization: _credential, ...headers } = request.headers;
  return headers;
}

/** Answers with the JSON `work` resolves to: 400 for a malformed request, 413 for an oversized one, 500 for other failures. */
function respond(response: ServerResponse, work: () => Promise<unknown>): void {
  work().then(
    (value) => sendJson(response, 200, value),
    (error: unknown) => sendJson(response, statusOf(error), { error: error instanceof Error ? error.message : String(error) }),
  );
}

function statusOf(error: unknown): number {
  if (error instanceof BadRequestError) return 400;
  if (error instanceof PayloadTooLargeError) return 413;
  return 500;
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  if (response.writableEnded || response.destroyed) return;
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(value));
}

/** The request body as text. Past `limit` bytes the rest is read and dropped, so the client gets its answer. */
function readBody(request: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    request.on('end', () => (size > limit ? reject(new PayloadTooLargeError(`Request body exceeds ${describeBytes(limit)}`)) : resolve(Buffer.concat(chunks).toString('utf8'))));
    request.on('error', reject);
  });
}

function describeBytes(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return Number.isInteger(megabytes) ? `${megabytes} MB` : `${bytes} bytes`;
}

function parseJson<TValue>(text: string): TValue {
  try {
    return JSON.parse(text) as TValue;
  } catch {
    throw new BadRequestError('Request body must be JSON');
  }
}

/** The text entries of a request's variable map; anything else is ignored. */
function textValues(value: unknown): Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

/** A webhook test body: JSON when it parses, the text itself otherwise, `{}` when empty. */
function parseLenient(text: string): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
