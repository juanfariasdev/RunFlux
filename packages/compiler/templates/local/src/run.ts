import 'dotenv/config';
import { CliHost } from '@runflux/runtime/cli';
import { engine, runWorkflow } from './workflow.js';

export { runWorkflow };

// npm run run '{"example": "payload"}'
if (CliHost.isEntrypoint(import.meta.url)) {
  process.exitCode = await new CliHost(engine).run(process.argv.slice(2));
}
