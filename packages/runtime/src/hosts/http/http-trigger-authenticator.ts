import { createHash, timingSafeEqual } from 'node:crypto';
import { systemEnvironment, type EnvironmentVariables } from '../../environment.js';
import type { HttpTrigger } from '../../workflow/triggers.js';

/**
 * Checks a request against its trigger's authentication. A secret that is not configured rejects
 * every request instead of letting them through.
 */
export class HttpTriggerAuthenticator {
  private readonly environment: () => EnvironmentVariables;

  /** The environment is read on every request, so rotated secrets apply without a restart. */
  constructor(environment: () => EnvironmentVariables = systemEnvironment) {
    this.environment = environment;
  }

  authorize(trigger: HttpTrigger, header: (name: string) => string | undefined): boolean {
    const { authentication } = trigger;
    if (authentication.type === 'none') return true;
    const secret = this.environment()[authentication.secretEnvVar];
    const provided = header(authentication.headerName);
    return Boolean(secret) && provided !== undefined && sameSecret(provided, secret!);
  }

  /**
   * The request headers a workflow may see: without the header carrying the secret, which must
   * never reach node outputs, logs or downstream services. Header names compare case-insensitively.
   */
  visibleHeaders(trigger: HttpTrigger, headers: Readonly<Record<string, unknown>>): Record<string, unknown> {
    if (trigger.authentication.type === 'none') return { ...headers };
    const secretHeader = trigger.authentication.headerName.toLowerCase();
    return Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== secretHeader));
  }
}

/** Compares digests, so the comparison takes the same time whatever the lengths are. */
function sameSecret(provided: string, secret: string): boolean {
  const digest = (text: string) => createHash('sha256').update(text).digest();
  return timingSafeEqual(digest(provided), digest(secret));
}
