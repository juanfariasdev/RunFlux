import path from 'node:path';
import { ConfigurationError } from './errors.js';
import { isLoopbackHost } from './security/loopback.js';

/** The shortest API token the server accepts (RN-03). */
export const MIN_API_TOKEN_LENGTH = 32;

/** The project server's settings, read once from the environment when it starts. */
export interface ServerConfig {
  readonly port: number;
  /** The address to listen on; loopback unless `HOST` says otherwise. */
  readonly host: string;
  /** The bearer token `/api/*` requires; mandatory when the host is not loopback. */
  readonly apiToken?: string;
  /** Origins allowed to read responses from a browser; none by default. */
  readonly corsOrigins: readonly string[];
  /** Largest JSON body, as a size such as `5mb`. */
  readonly bodyLimit: string;
  /** Where compiled backends are written; without it, `output-backends` next to the plugins. */
  readonly outputDirectory?: string;
}

/** Reads the settings, refusing with a `ConfigurationError` any the server must not start with (D-01). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const host = env.HOST?.trim() || '127.0.0.1';
  const apiToken = env.RUNFLUX_API_TOKEN || undefined;
  if (apiToken === undefined && !isLoopbackHost(host)) {
    throw new ConfigurationError('RUNFLUX_API_TOKEN', `HOST=${host} exposes the project server; set RUNFLUX_API_TOKEN (at least ${MIN_API_TOKEN_LENGTH} characters) to require it on every request.`);
  }
  if (apiToken !== undefined && apiToken.length < MIN_API_TOKEN_LENGTH) {
    throw new ConfigurationError('RUNFLUX_API_TOKEN', `RUNFLUX_API_TOKEN must have at least ${MIN_API_TOKEN_LENGTH} characters.`);
  }
  const bodyLimit = env.RUNFLUX_BODY_LIMIT?.trim() || '5mb';
  if (!/^\d+(\.\d+)?\s*(b|kb|mb|gb)?$/i.test(bodyLimit)) {
    throw new ConfigurationError('RUNFLUX_BODY_LIMIT', `RUNFLUX_BODY_LIMIT must be a size such as 5mb or 500kb, not "${bodyLimit}".`);
  }
  return {
    port: env.PORT ? parseInt(env.PORT, 10) : 3001,
    host,
    ...(apiToken ? { apiToken } : {}),
    corsOrigins: (env.RUNFLUX_CORS_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean),
    bodyLimit,
    ...(env.RUNFLUX_OUTPUT_DIR ? { outputDirectory: path.resolve(env.RUNFLUX_OUTPUT_DIR) } : {}),
  };
}
