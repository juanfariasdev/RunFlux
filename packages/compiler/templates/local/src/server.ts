import 'dotenv/config';
import type { AddressInfo } from 'node:net';
import { CronHost } from '@runflux/runtime/cron';
import { ExpressHost } from '@runflux/runtime/express';
import { stopOnSignal } from './lifecycle.js';
import { engine } from './workflow.js';

const server = new ExpressHost(engine);
const schedules = new CronHost(engine);

// Registered before starting, so a signal during startup also shuts down cleanly.
stopOnSignal(async () => {
  schedules.stop();
  await server.close();
});

const { port } = (await server.listen(Number(process.env.PORT ?? 3000))).address() as AddressInfo;
// Schedules normally run in their own process (npm run cron); this runs them inside the server.
if (process.env.ENABLE_INLINE_CRON === 'true') await schedules.start();
console.log(`[RunFlux] Listening on port ${port}`);
