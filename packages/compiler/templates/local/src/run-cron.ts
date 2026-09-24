import 'dotenv/config';
import { CronHost } from '@runflux/runtime/cron';
import { engine } from './workflow.js';

const schedules = new CronHost(engine);
await schedules.start();
console.log(`[RunFlux Cron] ${schedules.schedules.length} schedule(s) started`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void schedules.stop().then(() => process.exit(0));
  });
}
