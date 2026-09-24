import { defineNode, NodeOutput, type NodeHandler, type NodeInvocation } from '@runflux/runtime';

export interface CodeParameters {
  /** The body of an async function receiving `$json`, `$node` and `$env`. */
  readonly code: string;
}

type UserFunction = ($json: unknown, $node: unknown, $env: unknown) => Promise<unknown>;

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...parameters: string[]) => UserFunction;

/**
 * Runs user JavaScript with the privileges of the process: this is not a sandbox. Compiled
 * functions are cached by source, so repeated executions only pay for compilation once.
 */
export class CodeNode implements NodeHandler<CodeParameters> {
  private readonly compiled = new Map<string, UserFunction>();

  async execute({ parameters, input, context }: NodeInvocation<CodeParameters>): Promise<NodeOutput> {
    try {
      return NodeOutput.main(await this.compile(parameters.code)(input, context.nodes, context.env));
    } catch (error) {
      throw new Error(`[code-javascript]: Execution error: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }

  private compile(code: string): UserFunction {
    let compiled = this.compiled.get(code);
    if (!compiled) {
      compiled = new AsyncFunction('$json', '$node', '$env', code);
      this.compiled.set(code, compiled);
    }
    return compiled;
  }
}

export default defineNode<CodeParameters>({
  parseParameters: (parameters) => ({ code: parameters.string('code', 'return $json;').trim() }),
  createHandler: () => new CodeNode(),
});
