export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

export type HttpAuthentication =
  | { readonly type: 'none' }
  /** The request must carry the value of `secretEnvVar` in `headerName`. */
  | { readonly type: 'header'; readonly headerName: string; readonly secretEnvVar: string };

/** An HTTP endpoint that starts the workflow at one trigger node. */
export interface HttpTrigger {
  readonly nodeId: string;
  readonly path: string;
  readonly method: HttpMethod | 'ANY';
  readonly authentication: HttpAuthentication;
  /** Pass the body as text instead of parsing it as JSON. */
  readonly rawBody: boolean;
}

/** A cron schedule that starts the workflow at one trigger node. */
export interface ScheduleTrigger {
  readonly nodeId: string;
  /** Five-field Unix cron expression. */
  readonly expression: string;
  readonly timezone: string;
}

export interface WorkflowTriggers {
  readonly http: readonly HttpTrigger[];
  readonly schedules: readonly ScheduleTrigger[];
}

/** An entry point a trigger plugin declares for one of its nodes, before it is bound to that node. */
export type TriggerBinding =
  | ({ readonly kind: 'http' } & Omit<HttpTrigger, 'nodeId'>)
  | ({ readonly kind: 'schedule' } & Omit<ScheduleTrigger, 'nodeId'>);

/** A webhook call as a trigger node receives it: the payload hosts pass to the workflow. */
export interface WebhookRequest {
  readonly body: unknown;
  readonly headers: Readonly<Record<string, unknown>>;
  readonly query: Readonly<Record<string, unknown>>;
}

export const NO_TRIGGERS: WorkflowTriggers = { http: [], schedules: [] };

/** Paths the Express host serves itself, which no webhook may take. */
export const HOST_ROUTES = {
  /** `GET`: the backend's status. */
  health: '/health',
  /** `POST`: runs a workflow that has no HTTP trigger. */
  execute: '/api/execute',
} as const;

// RFC 9110 token characters.
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/** Whether `name` is a valid HTTP header field name. */
export function isHttpHeaderName(name: string): boolean {
  return HEADER_NAME.test(name);
}

/**
 * The form every component compares webhook paths in: one leading slash, no trailing or repeated
 * slashes. `orders/`, `//orders` and `/orders` are the same route.
 */
export function normalizeRoutePath(path: string): string {
  return `/${path.split('/').filter(Boolean).join('/')}`;
}

/** A webhook route as a `TriggerEventSource` channel: its method and normalized path. */
export interface WebhookRoute {
  readonly method: HttpMethod | 'ANY';
  readonly path: string;
}

const ROUTE_CHANNEL = /^([A-Z]+) (\/.*)$/;

/** The channel a webhook trigger of an editor test run waits on, e.g. `POST /orders`. */
export function webhookChannel(route: WebhookRoute): string {
  return `${route.method} ${normalizeRoutePath(route.path)}`;
}

/** Reads a webhook channel back; a bare path, as older callers send, accepts any method. */
export function parseWebhookChannel(channel: string): WebhookRoute {
  const match = ROUTE_CHANNEL.exec(channel);
  return match
    ? { method: match[1] as WebhookRoute['method'], path: normalizeRoutePath(match[2]) }
    : { method: 'ANY', path: normalizeRoutePath(channel) };
}
