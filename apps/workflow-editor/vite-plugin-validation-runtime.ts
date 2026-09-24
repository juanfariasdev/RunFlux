import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { WebhookTestHub } from '@runflux/plugin-system/node';
import { runNode, runWorkflow, type NodeResult, type PluginExecutionMode, type WorkflowDefinition } from '@runflux/validation-runtime/node';
import type { PluginRegistryCache } from './vite-plugin-registry.ts';

/** Body of `POST /runflux-validate`. */
interface ValidationRequest {
  workflow: WorkflowDefinition;
  /** Runs only this node, with `cachedResults` of nodes tested earlier as upstream data. */
  nodeId?: string;
  mode: PluginExecutionMode;
  cachedResults?: NodeResult[];
}

const WEBHOOK_TEST_PREFIXES = ['/runflux-webhook-test', '/api/webhooks/test'];
const DEFAULT_WEBHOOK_PATH = '/webhook';

class BadRequestError extends Error {}

/**
 * Dev-only endpoints of the editor, served from Vite's Node process, the only place plugin
 * runtimes can run:
 * - `POST /runflux-validate` runs a workflow, or one node of it, with the validation runtime. A
 *   client that disconnects cancels its run.
 * - `/runflux-webhook-test/<path>` hands a request to the webhook trigger of a test run waiting on
 *   `<path>`, so curl or a third-party service can drive a test.
 * - `POST /runflux-webhook-cancel` stops every waiting webhook trigger.
 */
export function runfluxValidationPlugin(plugins: PluginRegistryCache): Plugin {
  // Webhook triggers of test runs wait on this hub for the requests sent to their test URL.
  const webhooks = WebhookTestHub.shared();

  return {
    name: 'runflux-validation-runtime',
    configureServer(server) {
      plugins.watch(server);

      server.middlewares.use('/runflux-webhook-cancel', (_request, response) => {
        webhooks.cancelAll();
        sendJson(response, 200, { success: true, message: 'Listening cancelled' });
      });

      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        const prefix = WEBHOOK_TEST_PREFIXES.find((candidate) => url.pathname === candidate || url.pathname.startsWith(`${candidate}/`));
        if (!prefix) return next();
        respond(response, async () => {
          const body = parseLenient(await readBody(request));
          const captured = webhooks.deliver(url.pathname.slice(prefix.length) || DEFAULT_WEBHOOK_PATH, {
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
              : 'Webhook payload received, but no node was actively waiting for it. Click "Test this node" in the editor first.',
            data: body,
          };
        });
      });

      server.middlewares.use('/runflux-validate', (request, response) => {
        if (request.method !== 'POST') return sendJson(response, 405, { error: 'method not allowed, use POST' });
        const cancellation = new AbortController();
        response.once('close', () => {
          if (!response.writableFinished) cancellation.abort();
        });
        respond(response, async () => {
          const payload = parseJson<ValidationRequest>(await readBody(request));
          const registry = await plugins.registry();
          const options = { mode: payload.mode, services: { triggerEvents: webhooks }, signal: cancellation.signal };
          if (!payload.nodeId) return runWorkflow(payload.workflow, registry, options);
          const cache = new Map((payload.cachedResults ?? []).map((result) => [result.nodeId, result]));
          return runNode(payload.workflow, payload.nodeId, registry, options, cache);
        });
      });
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

/** A webhook test body: JSON when it parses, the text itself otherwise, `{}` when empty. */
function parseLenient(text: string): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
