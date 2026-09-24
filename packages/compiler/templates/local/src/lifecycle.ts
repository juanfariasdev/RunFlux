import { engine } from './workflow.js';

/**
 * On the first SIGINT or SIGTERM: runs `stop` (closing servers and schedules), waits for the runs
 * in progress, releases the engine's resources, such as database pools, and exits.
 */
export function stopOnSignal(stop: () => void | Promise<void>): void {
  let stopping: Promise<void> | undefined;
  const shutDown = (signal: NodeJS.Signals) => {
    stopping ??= (async () => {
      console.log(`[RunFlux] ${signal} received, shutting down`);
      try {
        await stop();
        await engine.dispose();
        process.exit(0);
      } catch (error) {
        console.error('[RunFlux] Shutdown failed:', error);
        process.exit(1);
      }
    })();
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, shutDown);
}
