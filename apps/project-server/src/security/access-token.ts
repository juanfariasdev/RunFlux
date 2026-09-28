import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

/** The token of an `Authorization: Bearer <token>` header, or undefined for any other header. */
export function bearerToken(header: string | undefined): string | undefined {
  const match = /^Bearer (.+)$/.exec(header ?? '');
  return match?.[1];
}

/** Compares digests, so the comparison takes the same time whatever the tokens are. */
export function tokenMatches(provided: string | undefined, token: string): boolean {
  if (provided === undefined) return false;
  const digest = (text: string) => createHash('sha256').update(text).digest();
  return timingSafeEqual(digest(provided), digest(token));
}

export const UNAUTHORIZED_BODY = { error: { code: 'UNAUTHORIZED', message: 'Authentication required', details: null } };

/** Refuses a request without the platform token, before anything reads its body (RN-02, D-03). */
export function requireAccessToken(token: string): RequestHandler {
  return (request, response, next) => {
    if (tokenMatches(bearerToken(request.headers.authorization), token)) return next();
    response.setHeader('WWW-Authenticate', 'Bearer');
    response.status(401).json(UNAUTHORIZED_BODY);
  };
}
