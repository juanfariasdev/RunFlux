import type { WorkflowEngine, RunRequest } from '../../engine/workflow-engine.js';
import type { WebhookRequest } from '../../workflow/triggers.js';
import { HttpTriggerAuthenticator } from '../http/http-trigger-authenticator.js';
import { HttpTriggerRouter } from '../http/http-trigger-router.js';

/** The fields RunFlux reads from a Lambda function URL request or a scheduled invocation. */
export interface LambdaEvent {
  readonly rawPath?: string;
  readonly requestContext?: { readonly http?: { readonly method?: string } };
  readonly headers?: Readonly<Record<string, string | undefined>>;
  readonly queryStringParameters?: Readonly<Record<string, string | undefined>>;
  readonly body?: string | null;
  readonly isBase64Encoded?: boolean;
  /** Set by the EventBridge schedules of the exported stack. */
  readonly runfluxTriggerId?: string;
}

export interface LambdaResponse {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface LambdaHostOptions {
  readonly authenticator?: HttpTriggerAuthenticator;
}

class BadRequest extends Error {}

/**
 * Runs a workflow inside AWS Lambda. HTTP requests are routed to their trigger like the Express
 * host does; other invocations (schedules) start the trigger named by `runfluxTriggerId`.
 */
export class LambdaHost {
  private readonly router: HttpTriggerRouter;
  private readonly authenticator: HttpTriggerAuthenticator;

  constructor(
    private readonly engine: WorkflowEngine,
    options: LambdaHostOptions = {},
  ) {
    this.router = new HttpTriggerRouter(engine.workflow.triggers.http);
    this.authenticator = options.authenticator ?? new HttpTriggerAuthenticator();
  }

  /** The Lambda handler, bound to this host. */
  readonly handler = async (event: LambdaEvent): Promise<LambdaResponse> => {
    try {
      const request = isHttp(event) ? this.httpRequest(event) : { payload: event, triggerId: event.runfluxTriggerId };
      if ('statusCode' in request) return request;
      const execution = await this.engine.run(request);
      return respond(execution.succeeded ? 200 : 500, execution.toResponse());
    } catch (error) {
      if (error instanceof BadRequest) return respond(400, { error: error.message });
      return respond(500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
  };

  private httpRequest(event: LambdaEvent): RunRequest | LambdaResponse {
    if (this.engine.workflow.triggers.http.length === 0) return { payload: parseJson(bodyText(event) || '{}') };
    const match = this.router.match(event.rawPath ?? '/', event.requestContext?.http?.method ?? 'POST');
    if (match.kind === 'not-found') return respond(404, { error: 'Webhook not found' });
    if (match.kind === 'method-not-allowed') return respond(405, { error: 'Method not allowed' });
    const { trigger } = match;
    const headers = Object.fromEntries(Object.entries(event.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]));
    if (!this.authenticator.authorize(trigger, (name) => headers[name.toLowerCase()])) return respond(401, { error: 'Unauthorized' });
    const text = bodyText(event);
    const payload: WebhookRequest = {
      body: trigger.rawBody ? text : text ? parseJson(text) : {},
      headers,
      query: event.queryStringParameters ?? {},
    };
    return { payload, triggerId: trigger.nodeId };
  }
}

function isHttp(event: LambdaEvent): boolean {
  return Boolean(event.requestContext?.http || event.rawPath);
}

function bodyText(event: LambdaEvent): string {
  const body = event.body ?? '';
  return event.isBase64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new BadRequest('Invalid JSON body');
  }
}

function respond(statusCode: number, value: unknown): LambdaResponse {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) };
}
