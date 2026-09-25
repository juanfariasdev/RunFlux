import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebhookTestHub } from '../webhook-test-hub';

const never = () => new AbortController().signal;

afterEach(() => vi.useRealTimers());

describe('WebhookTestHub', () => {
  it('delivers a request to the waiter on the same path, ignoring surrounding slashes', async () => {
    const hub = new WebhookTestHub();
    const waiting = hub.waitFor('/orders/', never());
    expect(hub.deliver('/unrelated', { body: 1 })).toBe(false);
    expect(hub.deliver('orders', { body: { id: 42 } })).toBe(true);
    await expect(waiting).resolves.toEqual({ body: { id: 42 } });
    expect(hub.pending).toBe(0);
    expect(hub.deliver('/orders', {})).toBe(false);
  });

  it('routes a request by method like the exported backends: exact method, then ANY, HEAD as GET', async () => {
    const hub = new WebhookTestHub();
    const signal = never();
    const get = hub.waitFor('GET /items', signal);
    const post = hub.waitFor('POST /items', signal);
    const any = hub.waitFor('ANY /items', signal);
    expect(hub.deliver('/items', { method: 'post', body: 'created' })).toBe(true);
    await expect(post).resolves.toMatchObject({ body: 'created' });
    expect(hub.deliver('/items', { method: 'HEAD' })).toBe(true);
    await expect(get).resolves.toMatchObject({ method: 'HEAD' });
    expect(hub.deliver('/items', { method: 'DELETE', body: 'fallback' })).toBe(true);
    await expect(any).resolves.toMatchObject({ body: 'fallback' });
    expect(hub.pending).toBe(0);
  });

  it('never hands a request to a waiter of another method, and lets requests without one reach any', async () => {
    const hub = new WebhookTestHub();
    const put = hub.waitFor('PUT /items', never());
    expect(hub.deliver('/items', { method: 'GET' })).toBe(false);
    expect(hub.deliver('/items', { body: 'no method' })).toBe(true);
    await expect(put).resolves.toEqual({ body: 'no method' });
  });

  it('compares paths like the exported backends route them', async () => {
    const hub = new WebhookTestHub();
    const waiting = hub.waitFor('hooks//orders', never());
    expect(hub.deliver('//hooks/orders/', { body: 'same route' })).toBe(true);
    await expect(waiting).resolves.toEqual({ body: 'same route' });
  });

  it('serves concurrent waiters on one path in the order they started waiting', async () => {
    const hub = new WebhookTestHub();
    const first = hub.waitFor('/a', never());
    const second = hub.waitFor('/a', never());
    hub.deliver('/a', { body: 1 });
    hub.deliver('/a', { body: 2 });
    expect([await first, await second]).toEqual([{ body: 1 }, { body: 2 }]);
  });

  it('gives up after its timeout', async () => {
    vi.useFakeTimers();
    const hub = new WebhookTestHub(1000);
    const waiting = hub.waitFor('/slow', never());
    const observed = expect(waiting).rejects.toThrow('Timeout waiting for incoming webhook request on "/slow" after 1s');
    await vi.advanceTimersByTimeAsync(1000);
    await observed;
    expect(hub.pending).toBe(0);
  });

  it('stops waiting when the run aborts, and never starts for an aborted run', async () => {
    const hub = new WebhookTestHub();
    const controller = new AbortController();
    const waiting = hub.waitFor('/cancel', controller.signal);
    controller.abort();
    await expect(waiting).rejects.toThrow('Cancelled: another trigger in this test run already fired');
    await expect(hub.waitFor('/cancel', controller.signal)).rejects.toThrow('Cancelled');
    expect(hub.pending).toBe(0);
    expect(hub.deliver('/cancel', {})).toBe(false);
  });

  it('rejects every waiter when cancelled', async () => {
    const hub = new WebhookTestHub();
    const waits = [hub.waitFor('/a', never()), hub.waitFor('/b', never())];
    hub.cancelAll();
    for (const wait of waits) await expect(wait).rejects.toThrow('Webhook listener cancelled');
    expect(hub.pending).toBe(0);
  });
});
