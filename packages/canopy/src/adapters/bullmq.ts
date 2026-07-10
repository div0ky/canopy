import { createHash, randomUUID } from 'node:crypto';
import { Injectable, type OnModuleDestroy, type OnModuleInit, type Type } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { JobDefinition, JobQueue } from '@evergreen/canopy-jobs';
import { FlowProducer, Queue, Worker, type FlowJob, type Job, type JobsOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import { ExecutionContext, type Actor } from '../context/execution-context.js';
import type {
  DispatchOptions,
  DispatchedJob,
  HandlesJob,
  JobDispatch,
  JobInvocation,
} from '../jobs/jobs.js';
import { FrameworkRegistry } from '../registry/framework-registry.js';
import type { ScheduleState, ScheduleSynchronizer } from '../scheduling/schedules.js';

interface CanopyJobData {
  readonly version: number;
  readonly payload: unknown;
  readonly context?: {
    readonly actor?: Actor;
    readonly correlationId: string;
    readonly causationId?: string;
    readonly locale: string;
    readonly traceId: string;
  };
  readonly timeoutMs: number;
}

const queueNames: readonly JobQueue[] = ['events', 'limited', 'cron'];

export class BullJobDispatcher implements JobDispatch, OnModuleDestroy {
  readonly #queues = new Map<
    JobQueue,
    Queue<CanopyJobData, void, string, CanopyJobData, void, string>
  >();
  readonly #flows: FlowProducer;

  public constructor(
    private readonly connection: Redis,
    private readonly context?: ExecutionContext,
    private readonly prefix = 'canopy',
  ) {
    for (const queue of queueNames) {
      this.#queues.set(
        queue,
        new Queue<CanopyJobData, void, string, CanopyJobData, void, string>(queue, {
          connection,
          prefix,
        }),
      );
    }
    this.#flows = new FlowProducer({ connection, prefix });
  }

  public async dispatch<TPayload>(
    definition: JobDefinition<TPayload>,
    payload: TPayload,
    options: DispatchOptions = {},
  ): Promise<DispatchedJob> {
    const id = this.jobId(options.deduplicationId ?? definition.deduplicate?.(payload));
    const job = await this.queue(definition.queue).add(
      definition.name,
      this.data(definition, payload),
      this.options(definition, options, id),
    );
    return { id: job.id ?? id, queue: definition.queue, name: definition.name };
  }

  public async chain(invocations: readonly JobInvocation[]): Promise<readonly DispatchedJob[]> {
    if (invocations.length === 0) return [];
    const ids = invocations.map((invocation) =>
      this.jobId(
        invocation.options?.deduplicationId ?? invocation.job.deduplicate?.(invocation.payload),
      ),
    );
    let flow = this.flowNode(invocations[0]!, ids[0]!);
    for (let index = 1; index < invocations.length; index += 1) {
      const parent = this.flowNode(invocations[index]!, ids[index]!);
      parent.children = [flow];
      flow = parent;
    }
    await this.#flows.add(flow);
    return invocations.map((invocation, index) => ({
      id: ids[index]!,
      queue: invocation.job.queue,
      name: invocation.job.name,
    }));
  }

  public batch(invocations: readonly JobInvocation[]): Promise<readonly DispatchedJob[]> {
    return Promise.all(
      invocations.map((invocation) =>
        this.dispatch(invocation.job, invocation.payload, invocation.options),
      ),
    );
  }

  public async retryFailed(id: string): Promise<DispatchedJob> {
    for (const [queueName, queue] of this.#queues) {
      const job = await queue.getJob(id);
      if (job && (await job.isFailed())) {
        await job.retry();
        return { id, queue: queueName, name: job.name };
      }
    }
    throw new Error(`Failed job ${id} was not found`);
  }

  public queue(name: JobQueue): Queue<CanopyJobData, void, string, CanopyJobData, void, string> {
    const queue = this.#queues.get(name);
    if (!queue) throw new Error(`Unknown queue ${name}`);
    return queue;
  }

  public async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.#queues.values()].map((queue) => queue.close()));
    await this.#flows.close();
  }

  private data<TPayload>(definition: JobDefinition<TPayload>, payload: TPayload): CanopyJobData {
    const active = this.context?.optional();
    return {
      version: definition.version,
      payload: definition.parse(payload),
      timeoutMs: definition.timeoutMs,
      ...(active
        ? {
            context: {
              correlationId: active.correlationId,
              causationId: active.causationId ?? active.correlationId,
              locale: active.locale,
              traceId: active.traceId,
              ...(active.actor ? { actor: active.actor } : {}),
            },
          }
        : {}),
    };
  }

  private options<TPayload>(
    definition: JobDefinition<TPayload>,
    options: DispatchOptions,
    id: string,
  ): JobsOptions {
    return {
      jobId: id,
      attempts: definition.attempts,
      backoff: { type: definition.backoff.type, delay: definition.backoff.delayMs },
      removeOnComplete: { count: definition.retainCompleted },
      removeOnFail: { count: definition.retainFailed },
      ...((options.priority ?? definition.priority)
        ? { priority: options.priority ?? definition.priority }
        : {}),
      ...(options.delayMs !== undefined ? { delay: options.delayMs } : {}),
    };
  }

  private flowNode(invocation: JobInvocation, id: string): FlowJob {
    return {
      name: invocation.job.name,
      queueName: invocation.job.queue,
      data: this.data(invocation.job, invocation.payload),
      opts: this.options(invocation.job, invocation.options ?? {}, id),
    };
  }

  private jobId(seed?: string): string {
    if (!seed) return randomUUID();
    const safe = seed.replaceAll(':', '-');
    return safe.length <= 100
      ? `canopy-${safe}`
      : `canopy-${createHash('sha256').update(seed).digest('hex')}`;
  }
}

@Injectable()
export class BullWorkerHost implements OnModuleInit, OnModuleDestroy {
  readonly #workers: Worker<CanopyJobData>[] = [];

  public constructor(
    private readonly connection: Redis,
    private readonly moduleRef: ModuleRef,
    private readonly context: ExecutionContext,
    private readonly prefix = 'canopy',
  ) {}

  public async onModuleInit(): Promise<void> {
    const handlers = new Map<
      string,
      { definition: JobDefinition<unknown>; instance: HandlesJob<unknown> }
    >();
    for (const { job, handler } of FrameworkRegistry.jobs()) {
      const instance = this.moduleRef.get(handler as unknown as Type<HandlesJob<unknown>>, {
        strict: false,
      });
      handlers.set(`${job.name}@${job.version}`, {
        definition: job as JobDefinition<unknown>,
        instance,
      });
    }
    for (const queue of queueNames) {
      this.#workers.push(
        new Worker<CanopyJobData>(queue, (job) => this.process(job, handlers), {
          connection: this.connection,
          prefix: this.prefix,
        }),
      );
    }
  }

  public async onModuleDestroy(): Promise<void> {
    await Promise.all(this.#workers.map((worker) => worker.close()));
  }

  private async process(
    job: Job<CanopyJobData>,
    handlers: ReadonlyMap<
      string,
      { definition: JobDefinition<unknown>; instance: HandlesJob<unknown> }
    >,
  ): Promise<void> {
    const registration = handlers.get(`${job.name}@${job.data.version}`);
    if (!registration)
      throw new Error(`No job handler registered for ${job.name}@${job.data.version}`);
    const payload = registration.definition.parse(job.data.payload);
    const run = async (): Promise<void> => {
      await Promise.race([
        registration.instance.handle(payload),
        new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error(`Job ${job.name} timed out`)),
            job.data.timeoutMs,
          ).unref();
        }),
      ]);
    };
    if (job.data.context) {
      await this.context.run(job.data.context, run);
    } else {
      await this.context.run(job.id ? { causationId: job.id } : {}, run);
    }
  }
}

export class BullScheduleSynchronizer implements ScheduleSynchronizer {
  public constructor(private readonly jobs: BullJobDispatcher) {}

  public async synchronize(): Promise<void> {
    for (const schedule of FrameworkRegistry.schedules()) {
      const definition = schedule.job as JobDefinition<Readonly<Record<string, unknown>>>;
      const queue = this.jobs.queue(definition.queue);
      if (!schedule.enabled) {
        await queue.removeJobScheduler(schedule.id);
        continue;
      }
      await queue.upsertJobScheduler(
        schedule.id,
        schedule.cron
          ? { pattern: schedule.cron, tz: schedule.timezone }
          : { every: schedule.everyMs! },
        {
          name: definition.name,
          data: {
            version: definition.version,
            payload: schedule.payload,
            timeoutMs: definition.timeoutMs,
          },
          opts: {},
        },
      );
    }
  }

  public async list(): Promise<readonly ScheduleState[]> {
    const states: ScheduleState[] = [];
    for (const queueName of queueNames) {
      const schedulers = await this.jobs.queue(queueName).getJobSchedulers();
      states.push(
        ...schedulers.map((scheduler) => ({
          id: scheduler.key,
          enabled: true,
          pattern: scheduler.pattern ?? String(scheduler.every ?? ''),
          timezone: scheduler.tz ?? 'UTC',
          nextRunAt: scheduler.next === undefined ? null : new Date(scheduler.next),
        })),
      );
    }
    return states;
  }
}
