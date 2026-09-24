import { describe, expect, it } from 'vitest';
import { HttpTriggerAuthenticator } from '../http/http-trigger-authenticator.js';
import { HttpTriggerRouter } from '../http/http-trigger-router.js';
import { httpTrigger } from './fixtures.js';

describe('HttpTriggerRouter', () => {
  const orders = httpTrigger('orders');
  const ordersGet = httpTrigger('ordersGet', { path: '/orders', method: 'GET' });
  const any = httpTrigger('any', { path: '/events', method: 'ANY' });
  const router = new HttpTriggerRouter([orders, ordersGet, any]);

  it.each([
    ['/orders', 'POST', orders],
    ['/orders', 'post', orders],
    ['/orders/', 'POST', orders],
    ['/orders', 'GET', ordersGet],
    ['/events', 'DELETE', any],
  ])('routes %s %s', (path, method, trigger) => {
    expect(router.match(path, method)).toEqual({ kind: 'matched', trigger });
  });

  it('prefers an exact method over ANY on the same path', () => {
    const exact = httpTrigger('exact', { path: '/same', method: 'PUT' });
    const fallback = httpTrigger('fallback', { path: '/same', method: 'ANY' });
    expect(new HttpTriggerRouter([fallback, exact]).match('/same', 'PUT')).toEqual({ kind: 'matched', trigger: exact });
  });

  it('distinguishes unknown paths from unsupported methods', () => {
    expect(router.match('/missing', 'POST')).toEqual({ kind: 'not-found' });
    expect(router.match('/Orders', 'POST')).toEqual({ kind: 'not-found' });
    expect(router.match('/orders', 'DELETE')).toEqual({ kind: 'method-not-allowed' });
  });
});

describe('HttpTriggerAuthenticator', () => {
  const secured = httpTrigger('orders', { authentication: { type: 'header', headerName: 'X-Key', secretEnvVar: 'ORDERS_KEY' } });
  const authenticator = (env: Record<string, string | undefined>) => new HttpTriggerAuthenticator(() => env);
  const headers = (value?: string) => (name: string) => (name === 'X-Key' ? value : undefined);

  it('lets every request through a trigger without authentication', () => {
    expect(authenticator({}).authorize(httpTrigger('open'), headers())).toBe(true);
  });

  it.each<[string | undefined, string | undefined, boolean]>([
    ['secret', 'secret', true],
    ['secret', 'wrong!', false],
    ['secret', 'secre', false],
    ['secret', undefined, false],
    [undefined, 'secret', false],
    ['', '', false],
  ])('with secret %j accepts header %j: %s', (secret, provided, accepted) => {
    expect(authenticator({ ORDERS_KEY: secret }).authorize(secured, headers(provided))).toBe(accepted);
  });

  it('reads the secret on every request', () => {
    const env: Record<string, string> = { ORDERS_KEY: 'old' };
    const current = authenticator(env);
    env.ORDERS_KEY = 'new';
    expect(current.authorize(secured, headers('new'))).toBe(true);
  });
});
