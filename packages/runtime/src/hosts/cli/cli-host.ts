import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { WorkflowRunner } from '../../contracts/runner.js';

export interface CliOutput {
  log(...values: unknown[]): void;
  error(...values: unknown[]): void;
}

/**
 * Runs a workflow once from the command line. The first argument is the payload: JSON, or any
 * other text passed as `{ raw: text }`. Disposing the runner is up to its owner.
 */
export class CliHost {
  private readonly runner: WorkflowRunner;
  private readonly output: CliOutput;

  constructor(runner: WorkflowRunner, output: CliOutput = console) {
    this.runner = runner;
    this.output = output;
  }

  /** Whether the module at `moduleUrl` is the script Node was started with. */
  static isEntrypoint(moduleUrl: string, script: string | undefined = process.argv[1]): boolean {
    return script !== undefined && fileURLToPath(moduleUrl) === resolve(script);
  }

  /** Runs the workflow and returns the process exit code. */
  async run(args: readonly string[]): Promise<number> {
    const payload = parsePayload(args[0]);
    this.output.log(`[RunFlux CLI] Executing workflow ${this.runner.workflow.name} with input:`, JSON.stringify(payload));
    try {
      const execution = await this.runner.run({ payload });
      this.output.log(JSON.stringify(execution.toResponse(), null, 2));
      return execution.succeeded ? 0 : 1;
    } catch (error) {
      this.output.error('[RunFlux CLI] Execution error:', error);
      return 1;
    }
  }
}

function parsePayload(argument: string | undefined): unknown {
  if (argument === undefined) return {};
  try {
    return JSON.parse(argument);
  } catch {
    return { raw: argument };
  }
}
