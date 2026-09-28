import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIPv4 } from 'node:net';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

/**
 * Settings the editor's dev server shares with the project server (feature 015, D-13): the
 * platform token and where the project server listens. Only these keys are read from the project
 * server's `.env`, so its database settings never reach the process that hosts test runs.
 */
export interface PlatformSettings {
  readonly apiToken?: string;
  /** Always loopback: the project server is reached on this machine (D-04, D-11). */
  readonly projectServerUrl: string;
}

export const PROJECT_SERVER_ENV_FILE = fileURLToPath(new URL('../project-server/.env', import.meta.url));

/** The settings from the shell, falling back to the project server's `.env` text; the shell wins. */
export function readPlatformSettings(shell: NodeJS.ProcessEnv, envFileText = ''): PlatformSettings {
  const file = envFileText ? parseEnv(envFileText) : {};
  const apiToken = shell.RUNFLUX_API_TOKEN || file.RUNFLUX_API_TOKEN || undefined;
  const port = shell.PORT || file.PORT || '3001';
  const projectServerUrl = (shell.RUNFLUX_PROJECT_SERVER_URL || `http://127.0.0.1:${port}`).replace(/\/+$/, '');
  return { ...(apiToken ? { apiToken } : {}), projectServerUrl };
}

/** No token and the default port: what a plugin gets when its caller passes no settings, as tests do. */
export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = readPlatformSettings({});

/** The settings of this machine: the shell environment and `apps/project-server/.env` when it exists. */
export function loadPlatformSettings(shell: NodeJS.ProcessEnv = process.env, envFile = PROJECT_SERVER_ENV_FILE): PlatformSettings {
  return readPlatformSettings(shell, existsSync(envFile) ? readFileSync(envFile, 'utf8') : '');
}

/** Whether a Vite `server.host` makes the dev server reachable from other machines. */
export function isExposedHost(host: string | boolean | undefined): boolean {
  if (host === true) return true;
  if (!host) return false;
  const normalized = host.trim().toLowerCase();
  if (normalized === 'localhost' || normalized === '::1') return false;
  return !(isIPv4(normalized) && normalized.startsWith('127.'));
}

/** Fails closed: an exposed dev server runs anyone's test runs unless the token guards them (RF-19). */
export function assertSafeExposure(host: string | boolean | undefined, apiToken: string | undefined): void {
  if (isExposedHost(host) && !apiToken) {
    throw new Error(`The editor's dev server listens on ${host === true ? 'every address' : host}; set RUNFLUX_API_TOKEN so its test endpoints require it.`);
  }
}

export interface AccessGuard {
  /** Whether the request carries the token; always true without one. */
  authorize(request: IncomingMessage): boolean;
  /** Connect middleware answering 401 to a request without the token. */
  middleware(request: IncomingMessage, response: ServerResponse, next: () => void): void;
}

/** Guards the test endpoints with the platform token, compared as digests in constant time. */
export function createAccessGuard(apiToken: string | undefined): AccessGuard {
  const authorize = (request: IncomingMessage): boolean => {
    if (!apiToken) return true;
    const match = /^Bearer (.+)$/.exec(request.headers.authorization ?? '');
    if (!match) return false;
    const digest = (text: string) => createHash('sha256').update(text).digest();
    return timingSafeEqual(digest(match[1]), digest(apiToken));
  };
  return {
    authorize,
    middleware(request, response, next) {
      if (authorize(request)) return next();
      response.statusCode = 401;
      response.setHeader('WWW-Authenticate', 'Bearer');
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ error: 'Authentication required' }));
    },
  };
}
