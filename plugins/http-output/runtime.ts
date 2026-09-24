import {
  defineNode,
  HTTP_METHODS,
  NodeOutput,
  type HttpClient,
  type HttpRequest,
  type NodeHandler,
  type NodeInvocation,
  type ParameterReader,
} from '@runflux/runtime';

/** Sends one HTTP request and outputs the response status, headers and body. */
export class HttpRequestNode implements NodeHandler<HttpRequest> {
  constructor(private readonly http: HttpClient) {}

  async execute({ parameters }: NodeInvocation<HttpRequest>): Promise<NodeOutput> {
    try {
      return NodeOutput.main(await this.http.send(parameters));
    } catch (error) {
      throw new Error(`http-output: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }
}

function readRequest(parameters: ParameterReader): HttpRequest {
  const method = parameters.string('method', 'GET').toUpperCase();
  if (!(HTTP_METHODS as readonly string[]).includes(method)) throw parameters.error('method', `"${method}" is not an HTTP method`);
  const headers = parameters.record('headers');
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value !== 'string') throw parameters.error('headers', `header "${name}" must be text`);
  }
  return { method, url: parameters.requiredString('url'), headers: headers as Record<string, string>, body: parameters.raw('body') };
}

export default defineNode<HttpRequest>({
  parseParameters: readRequest,
  createHandler: ({ http }) => new HttpRequestNode(http),
});
