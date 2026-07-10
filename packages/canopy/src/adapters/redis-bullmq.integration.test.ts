import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { QueueEvents, Worker } from 'bullmq';
import { z } from 'zod';
import type { JobDefinition } from '@evergreen/canopy-jobs';
import { defineJob } from '../jobs/jobs.js';
import { FrameworkRegistry } from '../registry/framework-registry.js';
import { BullJobDispatcher, BullScheduleSynchronizer } from './bullmq.js';
import { createRedis, RedisCache, RedisSessionStore } from './redis.js';

const integration = process.env['RUN_INTEGRATION'] === '1';
const connections: Array<ReturnType<typeof createRedis>> = [];
const closeables: Array<() => Promise<void>> = [];

const RetryJob = defineJob({
  name: 'integration.retry',
  version: 1,
  queue: 'limited',
  payload: z.object({ id: z.string() }),
  attempts: 2,
  backoff: { type: 'fixed', delayMs: 10 },
  timeoutMs: 1_000,
  retainCompleted: 10,
  retainFailed: 10,
  deduplicate: ({ id }) => id,
});

class IntegrationScheduleTarget {}
FrameworkRegistry.registerSchedule({
  id: 'integration.schedule',
  target: IntegrationScheduleTarget,
  propertyKey: 'run',
  everyMs: 60_000,
  timezone: 'UTC',
  overlap: 'skip',
  enabled: true,
  job: RetryJob,
  payload: { id: 'scheduled' },
});

function connection(): ReturnType<typeof createRedis> {
  const redis = createRedis(process.env['REDIS_URL'] ?? 'redis://localhost:6379');
  connections.push(redis);
  return redis;
}

describe.skipIf(!integration)('Redis and BullMQ integration', () => {
  afterEach(async () => {
    await Promise.all(closeables.splice(0).map((close) => close()));
    await Promise.all(connections.splice(0).map((redis) => redis.quit()));
  });

  it('provides distributed locks, counters, tags, and rate limiting', async () => {
    const redis = connection();
    await redis.flushdb();
    const cache = new RedisCache(redis, `integration:${randomUUID()}:`);
    await cache.set('order', { id: 1 }, { tags: ['orders'], ttlMs: 1_000 });
    expect(await cache.get('order')).toEqual({ id: 1 });
    const lock = await cache.lock('order', 1_000);
    await expect(cache.lock('order', 1_000)).rejects.toThrow(/unavailable/);
    await lock.release();
    expect((await cache.rateLimit('user', 1, 1_000)).allowed).toBe(true);
    expect((await cache.rateLimit('user', 1, 1_000)).allowed).toBe(false);
    const sessions = new RedisSessionStore(redis, `integration:${randomUUID()}:session:`);
    await sessions.put({
      id: 'one',
      actor: { id: 'user-1', type: 'user' },
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect((await sessions.get('one'))?.actor.id).toBe('user-1');
  });

  it('deduplicates jobs and creates dependency chains', async () => {
    const redis = connection();
    const prefix = `integration-${randomUUID()}`;
    const dispatcher = new BullJobDispatcher(redis, undefined, prefix);
    closeables.push(() => dispatcher.onModuleDestroy());
    const first = await dispatcher.dispatch(RetryJob, { id: 'same' });
    const second = await dispatcher.dispatch(RetryJob, { id: 'same' });
    expect(second.id).toBe(first.id);
    expect(await dispatcher.queue('limited').count()).toBe(1);
    const chain = await dispatcher.chain([
      { job: RetryJob as unknown as JobDefinition<unknown>, payload: { id: 'first' } },
      { job: RetryJob as unknown as JobDefinition<unknown>, payload: { id: 'second' } },
    ]);
    expect(chain).toHaveLength(2);
    expect(await dispatcher.queue('limited').getJob(chain[1]!.id)).not.toBeNull();
  });

  it('retries failures, synchronizes schedules, and shuts workers down cleanly', async () => {
    const redis = connection();
    const prefix = `integration-${randomUUID()}`;
    const dispatcher = new BullJobDispatcher(redis, undefined, prefix);
    closeables.push(() => dispatcher.onModuleDestroy());
    let attempts = 0;
    const worker = new Worker(
      'limited',
      async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('retry me');
      },
      { connection: redis, prefix },
    );
    const events = new QueueEvents('limited', { connection: redis, prefix });
    await events.waitUntilReady();
    const dispatched = await dispatcher.dispatch(RetryJob, { id: 'retry' });
    const job = await dispatcher.queue('limited').getJob(dispatched.id);
    await job!.waitUntilFinished(events, 5_000);
    expect(attempts).toBe(2);

    const schedules = new BullScheduleSynchronizer(dispatcher);
    await schedules.synchronize();
    expect((await schedules.list()).some(({ id }) => id === 'integration.schedule')).toBe(true);

    await worker.close();
    await events.close();
    expect(worker.closing).toBeDefined();
  });
});
