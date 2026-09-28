import type { RequestHandler } from 'express';
import { bearerToken, tokenMatches, UNAUTHORIZED_BODY } from './access-token.js';
import { isLoopbackAddress } from './loopback.js';

export type InternalAccess = 'allowed' | 'forbidden' | 'unauthorized';

/**
 * Who may use the internal routes (D-11): only a process on this machine, never a browser page
 * (which always sends `Origin`), and with the platform token when one is configured.
 */
export function checkInternalAccess(request: { remoteAddress: string | undefined; origin?: string; authorization?: string }, token?: string): InternalAccess {
  if (!isLoopbackAddress(request.remoteAddress) || request.origin !== undefined) return 'forbidden';
  if (token !== undefined && !tokenMatches(bearerToken(request.authorization), token)) return 'unauthorized';
  return 'allowed';
}

const FORBIDDEN_BODY = { error: { code: 'FORBIDDEN', message: 'Internal route', details: null } };

export function internalGuard(token?: string): RequestHandler {
  return (request, response, next) => {
    const access = checkInternalAccess({ remoteAddress: request.socket.remoteAddress, origin: request.headers.origin, authorization: request.headers.authorization }, token);
    if (access === 'allowed') return next();
    if (access === 'unauthorized') {
      response.setHeader('WWW-Authenticate', 'Bearer');
      return response.status(401).json(UNAUTHORIZED_BODY);
    }
    response.status(403).json(FORBIDDEN_BODY);
  };
}
