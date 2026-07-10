import type { JobDefinition } from '@evergreen/canopy-jobs';
import { FrameworkRegistry, type ConcreteConstructor } from '../registry/framework-registry.js';

interface CommonScheduleOptions<TPayload> {
  readonly id: string;
  readonly job: JobDefinition<TPayload>;
  readonly payload: TPayload;
  readonly timezone?: string;
  readonly overlap?: 'allow' | 'skip';
  readonly enabled?: boolean;
}

export type ScheduleOptions<TPayload> = CommonScheduleOptions<TPayload> &
  (
    | { readonly cron: string; readonly everyMs?: never }
    | { readonly cron?: never; readonly everyMs: number }
  );

export function Schedule<TPayload>(options: ScheduleOptions<TPayload>): MethodDecorator {
  return (target, propertyKey) => {
    if (!options.cron && (!options.everyMs || options.everyMs < 1_000)) {
      throw new Error(`Schedule ${options.id} requires a cron pattern or interval >= 1000ms`);
    }
    FrameworkRegistry.registerSchedule({
      id: options.id,
      target: target.constructor as ConcreteConstructor,
      propertyKey: String(propertyKey),
      ...(options.cron ? { cron: options.cron } : {}),
      ...(options.everyMs ? { everyMs: options.everyMs } : {}),
      timezone: options.timezone ?? 'UTC',
      overlap: options.overlap ?? 'skip',
      enabled: options.enabled ?? true,
      job: options.job,
      payload: options.job.parse(options.payload) as Readonly<Record<string, unknown>>,
    });
  };
}

export interface ScheduleState {
  readonly id: string;
  readonly enabled: boolean;
  readonly pattern: string;
  readonly timezone: string;
  readonly nextRunAt: Date | null;
}

export interface ScheduleSynchronizer {
  synchronize(): Promise<void>;
  list(): Promise<readonly ScheduleState[]>;
}
