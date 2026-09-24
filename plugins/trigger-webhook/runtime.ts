import {
  defineNode,
  FieldComposer,
  isRecord,
  NodeOutput,
  readFields,
  type NodeContext,
  type NodeHandler,
  type NodeInvocation,
  type ParameterReader,
  type TriggerEventSource,
  type WebhookRequest,
} from '@runflux/runtime';
import { readWebhookPath } from './settings.js';

export interface WebhookTriggerParameters {
  readonly path: string;
  /** The request used when a test run has no real one to wait for. */
  readonly sample: WebhookRequest;
}

const DEFAULT_SAMPLE_BODY = { message: 'Sample webhook payload' };

/**
 * Starts a run with an HTTP request, exposing the JSON body's fields next to `_headers` and
 * `_query` (other bodies go under `data`). Hosts pass the request in. When a test run starts the
 * trigger without one, it waits for a test request or, if nothing delivers them, uses the sample;
 * a production run without a request gets an empty one, never the sample.
 */
export class WebhookTriggerNode implements NodeHandler<WebhookTriggerParameters> {
  constructor(private readonly events?: TriggerEventSource) {}

  async execute({ parameters, input, context }: NodeInvocation<WebhookTriggerParameters>): Promise<NodeOutput> {
    return NodeOutput.main(toTriggerOutput(await this.request(parameters, input, context)));
  }

  private async request(parameters: WebhookTriggerParameters, input: unknown, context: NodeContext): Promise<unknown> {
    if (input !== undefined) return isWebhookRequest(input) ? input : { body: input };
    if (context.mode === 'production') return {};
    return this.events ? this.events.waitFor(parameters.path, context.signal) : parameters.sample;
  }
}

function isWebhookRequest(value: unknown): value is Partial<WebhookRequest> {
  return isRecord(value) && ('body' in value || 'headers' in value || 'query' in value);
}

function toTriggerOutput(request: unknown): Record<string, unknown> {
  const { body, headers, query } = isRecord(request) ? request : {};
  const meta = { _headers: headers ?? {}, _query: query ?? {} };
  return isRecord(body) ? { ...body, ...meta } : { data: body, ...meta };
}

function readSample(parameters: ParameterReader, fields: FieldComposer): WebhookRequest {
  const body = parameters.raw('sampleBody');
  return {
    body: Array.isArray(body) ? fields.compose(readFields(parameters, 'sampleBody')) : isRecord(body) ? body : DEFAULT_SAMPLE_BODY,
    headers: parameters.record('sampleHeaders'),
    query: parameters.record('sampleQuery'),
  };
}

const fields = new FieldComposer();

export default defineNode<WebhookTriggerParameters>({
  parseParameters: (parameters) => ({ path: readWebhookPath(parameters), sample: readSample(parameters, fields) }),
  createHandler: ({ triggerEvents }) => new WebhookTriggerNode(triggerEvents),
});
