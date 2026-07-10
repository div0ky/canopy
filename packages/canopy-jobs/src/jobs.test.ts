import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineJob } from './index.js';

describe('defineJob', () => {
  it('freezes versioned definitions and parses payloads', () => {
    const job = defineJob({
      name: 'orders.test',
      version: 2,
      queue: 'events',
      payload: z.object({ id: z.string().uuid() }),
      attempts: 3,
      backoff: { type: 'exponential', delayMs: 100 },
      timeoutMs: 1_000,
      retainCompleted: 10,
      retainFailed: 20,
    });
    expect(job.parse({ id: '00000000-0000-4000-8000-000000000001' })).toEqual({
      id: '00000000-0000-4000-8000-000000000001',
    });
    expect(Object.isFrozen(job)).toBe(true);
  });

  it('rejects unstable names and versions', () => {
    expect(() =>
      defineJob({
        name: 'Bad Name',
        version: 0,
        queue: 'events',
        payload: z.object({}),
        attempts: 1,
        backoff: { type: 'fixed', delayMs: 1 },
        timeoutMs: 1,
        retainCompleted: 1,
        retainFailed: 1,
      }),
    ).toThrow();
  });
});
