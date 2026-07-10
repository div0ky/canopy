import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineJob } from '../jobs/jobs.js';
import {
  FakeBroadcaster,
  FakeJobDispatcher,
  FakeNotificationSender,
  FakeStorage,
  InMemoryCache,
  InMemorySessionStore,
} from './fakes.js';

describe('framework fakes', () => {
  it('supports cache tags, locks, counters, and rate limiting', async () => {
    const cache = new InMemoryCache();
    await cache.set('order:1', { id: 1 }, { tags: ['orders'] });
    expect(await cache.get('order:1')).toEqual({ id: 1 });
    await cache.flushTags(['orders']);
    expect(await cache.get('order:1')).toBeNull();
    const lock = await cache.lock('order:1', 1_000);
    await expect(cache.lock('order:1', 1_000)).rejects.toThrow(/unavailable/);
    await lock.release();
    expect(await cache.increment('orders')).toBe(1);
    expect((await cache.rateLimit('actor', 1, 1_000)).allowed).toBe(true);
    expect((await cache.rateLimit('actor', 1, 1_000)).allowed).toBe(false);
  });

  it('captures storage, jobs, notifications, and broadcasts', async () => {
    const sessions = new InMemorySessionStore();
    await sessions.put({
      id: 'session-1',
      actor: { id: 'user-1', type: 'user' },
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect((await sessions.get('session-1'))?.actor.id).toBe('user-1');

    const storage = new FakeStorage();
    await storage.disk().put('orders/one.txt', new TextEncoder().encode('one'));
    expect(new TextDecoder().decode(await storage.disk().get('orders/one.txt'))).toBe('one');

    const definition = defineJob({
      name: 'test.fake',
      version: 1,
      queue: 'events',
      payload: z.object({ id: z.string() }),
      attempts: 1,
      backoff: { type: 'fixed', delayMs: 1 },
      timeoutMs: 100,
      retainCompleted: 1,
      retainFailed: 1,
    });
    const jobs = new FakeJobDispatcher();
    await jobs.dispatch(definition, { id: 'one' });
    expect(jobs.dispatched[0]?.name).toBe('test.fake');

    const notifications = new FakeNotificationSender();
    await notifications.send({ id: 'user' }, { name: 'test', via: () => ['database'] });
    expect(notifications.sent).toHaveLength(1);

    const broadcaster = new FakeBroadcaster();
    await broadcaster.broadcast({ channel: 'orders', event: 'created', payload: { id: 'one' } });
    expect(broadcaster.messages).toHaveLength(1);
  });
});
