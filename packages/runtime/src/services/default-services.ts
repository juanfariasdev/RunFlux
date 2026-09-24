import type { Clock, Logger, RuntimeServices } from '../contracts/services.js';
import { FetchHttpClient } from '../http/http-client.js';
import { ServiceRegistry } from './service-registry.js';

export class ConsoleLogger implements Logger {
  info(message: string, ...details: unknown[]): void {
    console.log(message, ...details);
  }

  error(message: string, ...details: unknown[]): void {
    console.error(message, ...details);
  }
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Production services, with any of them replaced by `overrides`. */
export function createRuntimeServices(overrides: Partial<RuntimeServices> = {}): RuntimeServices {
  return {
    http: overrides.http ?? new FetchHttpClient(),
    logger: overrides.logger ?? new ConsoleLogger(),
    clock: overrides.clock ?? new SystemClock(),
    triggerEvents: overrides.triggerEvents,
    extensions: overrides.extensions ?? new ServiceRegistry(),
  };
}
