import { describe, expect, it } from 'vitest';
import { resolveSampleBodyForTest, webhookTestRequest } from '../webhook-test-request';

describe('webhookTestRequest', () => {
  const origin = 'http://localhost:5173';

  it('sends the sample body with the method the webhook answers', () => {
    const request = webhookTestRequest({ path: '/items', httpMethod: 'put', sampleBody: [{ name: 'id', value: '7', type: 'number' }] }, origin);
    expect(request).toEqual({
      method: 'PUT',
      url: 'http://localhost:5173/runflux-webhook-test/items',
      init: { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"id":7}' },
    });
  });

  it('sends GET and HEAD without a body, with the sample query in the URL', () => {
    const request = webhookTestRequest({ path: '/items', httpMethod: 'GET', sampleQuery: { category: 'hardware', page: 2 }, sampleBody: [{ name: 'x', value: '1' }] }, origin);
    expect(request).toEqual({ method: 'GET', url: 'http://localhost:5173/runflux-webhook-test/items?category=hardware&page=2', init: { method: 'GET' } });
    expect(webhookTestRequest({ httpMethod: 'HEAD' }, origin).init).toEqual({ method: 'HEAD' });
  });

  it('uses POST for a webhook of any method, and the default path and method when unset', () => {
    expect(webhookTestRequest({ httpMethod: 'ANY', path: 'events' }, origin)).toMatchObject({ method: 'POST', url: 'http://localhost:5173/runflux-webhook-test/events' });
    expect(webhookTestRequest({}, origin)).toMatchObject({ method: 'POST', url: 'http://localhost:5173/runflux-webhook-test/webhook' });
  });
});

describe('resolveSampleBodyForTest', () => {
  it('composes sample field rows the way the webhook trigger does', () => {
    expect(resolveSampleBodyForTest([{ name: 'id', value: '42', type: 'number' }, { name: 'tags', value: ['a'], type: 'array' }, { value: 'unnamed' }]))
      .toEqual({ id: 42, tags: ['a'] });
  });

  it('sends an empty body while a row is still invalid instead of failing', () => {
    expect(resolveSampleBodyForTest([{ name: 'id', value: 'forty-two', type: 'number' }])).toEqual({});
    expect(resolveSampleBodyForTest([{ name: 'when', value: 'now', type: 'date' }])).toEqual({});
    expect(resolveSampleBodyForTest(['not a row'])).toEqual({});
  });

  it('keeps an object sample and falls back to a default one', () => {
    expect(resolveSampleBodyForTest({ literal: true })).toEqual({ literal: true });
    expect(resolveSampleBodyForTest(undefined)).toEqual({ message: 'Sample test payload' });
  });
});
