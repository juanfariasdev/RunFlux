import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { WorkflowEngine } from '../../engine/workflow-engine.js';

export interface CliOutput {
  log(...values: unknown[]): void;
  error(...values: unknown[]): void;
}

/**
 * Runs a workflow once from the command line. The first argument is the payload: JSON, or any
 * other text passed as `{ raw: text }`.
 */
export class CliHost {
  constructor(
    private readonly engine: WorkflowEngine,
    private readonly output: CliOutput = console,
  ) {}

  /** Whether the module at `moduleUrl` is the script Node was started with. */
  static isEntrypoint(moduleUrl: string, script: string | undefined = process.argv[1]): boolean {
    return script !== undefined && fileURLToPath(moduleUrl) === resolve(script);
  }

  /** Runs the workflow and returns the process exit code. */
  async run(args: readonly string[]): Promise<number> {
    const payload = parsePayload(args[0]);
    this.output.log(`[RunFlux CLI] Executing workflow ${this.engine.workflow.name} with input:`, JSON.stringify(payload));
    try {
      const execution = await this.engine.run({ payload });
      this.output.log(JSON.stringify(execution.toResponse(), null, 2));
      return execution.succeeded ? 0 : 1;
    } catch (error) {
      this.output.error('[RunFlux CLI] Execution error:', error);
      return 1;
    } finally {
      await this.engine.dispose();
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
