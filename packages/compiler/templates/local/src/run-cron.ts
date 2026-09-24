import 'dotenv/config';
import { CronHost } from '@runflux/runtime/cron';
import { stopOnSignal } from './lifecycle.js';
import { engine } from './workflow.js';

const schedules = new CronHost(engine);
// Registered before starting, so a signal during startup also shuts down cleanly.
stopOnSignal(() => schedules.stop());

await schedules.start();
console.log(`[RunFlux Cron] ${schedules.schedules.length} schedule(s) started`);
