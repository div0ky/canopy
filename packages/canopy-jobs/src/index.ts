import type { ZodType } from 'zod';
import { z } from 'zod';

export type JobQueue = 'events' | 'limited' | 'cron';
export type JobBackoff =
  | { readonly type: 'fixed'; readonly delayMs: number }
  | { readonly type: 'exponential'; readonly delayMs: number };

export interface JobDefinition<TPayload> {
  readonly name: string;
  readonly version: number;
  readonly queue: JobQueue;
  readonly payload: ZodType<TPayload>;
  readonly attempts: number;
  readonly backoff: JobBackoff;
  readonly timeoutMs: number;
  readonly retainCompleted: number;
  readonly retainFailed: number;
  readonly priority?: number;
  readonly deduplicate?: (payload: TPayload) => string;
  parse(input: unknown): TPayload;
}

export type JobOptions<TPayload> = Omit<JobDefinition<TPayload>, 'parse'>;

export function defineJob<TPayload>(options: JobOptions<TPayload>): JobDefinition<TPayload> {
  if (!/^[a-z][a-z0-9_.-]+$/.test(options.name)) {
    throw new Error(`Invalid job name: ${options.name}`);
  }
  if (options.version < 1 || !Number.isInteger(options.version)) {
    throw new Error(`Job ${options.name} must have a positive integer version`);
  }
  return Object.freeze({
    ...options,
    parse: (input: unknown) => options.payload.parse(input),
  });
}

const defaultJobOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delayMs: 1_000 } as const,
  timeoutMs: 30_000,
  retainCompleted: 1_000,
  retainFailed: 5_000,
};

export const PublishEventJob = defineJob({
  ...defaultJobOptions,
  name: 'canopy.event.publish',
  version: 1,
  queue: 'events',
  payload: z.object({
    outboxId: z.string().uuid(),
    eventType: z.string(),
    eventVersion: z.number().int().positive(),
    payload: z.record(z.unknown()),
    metadata: z.record(z.unknown()),
  }),
  deduplicate: ({ outboxId }) => outboxId,
});

export const SendNotificationJob = defineJob({
  ...defaultJobOptions,
  name: 'canopy.notification.send',
  version: 1,
  queue: 'limited',
  payload: z.object({
    outboxId: z.string().uuid(),
    notification: z.string(),
    notifiableId: z.string().uuid(),
    channels: z.array(z.enum(['database', 'sms', 'email', 'broadcast'])),
    data: z.record(z.unknown()),
  }),
  deduplicate: ({ outboxId }) => outboxId,
});

export const CloseStaleOrdersJob = defineJob({
  ...defaultJobOptions,
  name: 'orders.close-stale',
  version: 1,
  queue: 'cron',
  payload: z.object({
    olderThanHours: z.number().int().positive().default(24),
    batchSize: z.number().int().positive().max(1_000).default(100),
  }),
  deduplicate: ({ olderThanHours, batchSize }) => `${olderThanHours}:${batchSize}`,
});
