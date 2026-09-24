import type { HttpClient } from '../http/http-client.js';
import type { ServiceLookup } from '../services/service-registry.js';

export interface Logger {
  info(message: string, ...details: unknown[]): void;
  error(message: string, ...details: unknown[]): void;
}

export interface Clock {
  now(): Date;
}

/**
 * Delivers external events to trigger nodes that wait for one, such as a test request sent to a
 * webhook while the editor runs its workflow. Exported backends pass events in through their hosts.
 */
export interface TriggerEventSource {
  waitFor(channel: string, signal: AbortSignal): Promise<unknown>;
}

/**
 * Everything a node handler may depend on. Every member is an interface, so hosts and tests can
 * replace any of them and plugins built against another copy of this package still type-check.
 */
export interface RuntimeServices {
  readonly http: HttpClient;
  readonly logger: Logger;
  readonly clock: Clock;
  readonly triggerEvents?: TriggerEventSource;
  /** Plugin-specific services, e.g. a database client replaced in tests. */
  readonly extensions: ServiceLookup;
}
