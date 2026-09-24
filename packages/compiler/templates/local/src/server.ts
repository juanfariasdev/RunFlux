import 'dotenv/config';
import { CronHost } from '@runflux/runtime/cron';
import { ExpressHost } from '@runflux/runtime/express';
import { engine } from './workflow.js';

const port = Number(process.env.PORT ?? 3000);
const server = new ExpressHost(engine);
const schedules = new CronHost(engine);

await server.listen(port);
console.log(`[RunFlux] Listening on port ${port}`);
// Schedules normally run in their own process (npm run cron); this runs them inside the server.
if (process.env.ENABLE_INLINE_CRON === 'true') await schedules.start();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void Promise.all([server.close(), schedules.stop()]).then(() => process.exit(0));
  });
}
