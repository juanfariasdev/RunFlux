import { timingSafeEqual } from 'node:crypto';
import { systemEnvironment, type EnvironmentVariables } from '../../environment.js';
import type { HttpTrigger } from '../../workflow/triggers.js';

/**
 * Checks a request against its trigger's authentication. A secret that is not configured rejects
 * every request instead of letting them through.
 */
export class HttpTriggerAuthenticator {
  /** The environment is read on every request, so rotated secrets apply without a restart. */
  private readonly environment: () => EnvironmentVariables;

  constructor(environment: () => EnvironmentVariables = systemEnvironment) {
    this.environment = environment;
  }

  authorize(trigger: HttpTrigger, header: (name: string) => string | undefined): boolean {
    const { authentication } = trigger;
    if (authentication.type === 'none') return true;
    const secret = this.environment()[authentication.secretEnvVar];
    const provided = header(authentication.headerName);
    return Boolean(secret) && provided !== undefined && sameText(provided, secret!);
  }
}

function sameText(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
