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
  /** The project's variables, which test runs read as `$env` before the server's own. */
  environment?: Record<string, string>;
}

/** What the handlers need from the webhook test hub: triggers wait on it and requests reach them through it. */
export interface WebhookDelivery extends TriggerEventSource {
  deliver(path: string, request: { body?: unknown; headers?: unknown; query?: unknown; method?: string }): boolean;
  cancelAll(): void;
}

export interface ValidationHttpOptions {
  /** The plugins test runs execute; asked on every run, so a catalog that rediscovers edited plugins is honored. */
  readonly catalog: () => Promise<ValidationCatalog>;
  readonly webhooks: WebhookDelivery;
  /** `$env` under the project's variables. Defaults to the server process environment. */
  readonly environment?: () => EnvironmentVariables;
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

const WEBHOOK_TEST_PREFIXES = ['/runflux-webhook-test', '/api/webhooks/test'];
const DEFAULT_WEBHOOK_PATH = '/webhook';

class BadRequestError extends Error {}

export function createValidationHttpHandlers(options: ValidationHttpOptions): ValidationHttpHandlers {
  const { webhooks } = options;
  const environment = options.environment ?? (() => process.env);

  return {
    validate(request, response) {
      if (request.method !== 'POST') return sendJson(response, 405, { error: 'method not allowed, use POST' });
      const cancellation = new AbortController();
      response.once('close', () => {
        if (!response.writableFinished) cancellation.abort();
      });
      respond(response, async () => {
        const payload = parseJson<ValidationRequest>(await readBody(request));
        const catalog = await options.catalog();
        const runOptions = {
          mode: payload.mode,
          services: { triggerEvents: webhooks },
          signal: cancellation.signal,
          environment: { ...environment(), ...textValues(payload.environment) },
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
        const body = parseLenient(await readBody(request));
        const path = url.pathname.slice(prefix.length) || DEFAULT_WEBHOOK_PATH;
        const captured = webhooks.deliver(path, {
          body,
          headers: request.headers,
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

    cancelWebhooks(_request, response) {
      webhooks.cancelAll();
      sendJson(response, 200, { success: true, message: 'Listening cancelled' });
    },
  };
}

/** Answers with the JSON `work` resolves to: 400 for a malformed request, 500 for other failures. */
function respond(response: ServerResponse, work: () => Promise<unknown>): void {
  work().then(
    (value) => sendJson(response, 200, value),
    (error: unknown) => sendJson(response, error instanceof BadRequestError ? 400 : 500, { error: error instanceof Error ? error.message : String(error) }),
  );
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  if (response.writableEnded || response.destroyed) return;
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(value));
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
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
