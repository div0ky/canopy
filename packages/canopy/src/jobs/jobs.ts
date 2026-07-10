import { Inject, Injectable } from '@nestjs/common';
import type { JobDefinition } from '@evergreen/canopy-jobs';
import { ExecutionContext } from '../context/execution-context.js';
import { FrameworkRegistry, type ConcreteConstructor } from '../registry/framework-registry.js';
import { CANOPY_JOB_DISPATCHER } from '../tokens.js';

export { defineJob } from '@evergreen/canopy-jobs';
export type { JobBackoff, JobDefinition, JobOptions, JobQueue } from '@evergreen/canopy-jobs';

export interface DispatchOptions {
  readonly delayMs?: number;
  readonly priority?: number;
  readonly deduplicationId?: string;
}

export interface DispatchedJob {
  readonly id: string;
  readonly queue: string;
  readonly name: string;
}

export interface JobDispatch {
  dispatch<TPayload>(
    job: JobDefinition<TPayload>,
    payload: TPayload,
    options?: DispatchOptions,
  ): Promise<DispatchedJob>;
  chain(jobs: readonly JobInvocation[]): Promise<readonly DispatchedJob[]>;
  batch(jobs: readonly JobInvocation[]): Promise<readonly DispatchedJob[]>;
  retryFailed(id: string): Promise<DispatchedJob>;
}

export interface JobInvocation<TPayload = unknown> {
  readonly job: JobDefinition<TPayload>;
  readonly payload: TPayload;
  readonly options?: DispatchOptions;
}

export function JobHandler<TPayload>(job: JobDefinition<TPayload>): ClassDecorator {
  return (target) => {
    FrameworkRegistry.registerJob({
      job,
      handler: target as unknown as ConcreteConstructor,
    });
  };
}

export interface HandlesJob<TPayload> {
  handle(payload: TPayload): void | Promise<void>;
}

@Injectable()
export class Jobs {
  public constructor(
    @Inject(CANOPY_JOB_DISPATCHER) private readonly dispatcher: JobDispatch,
    @Inject(ExecutionContext) private readonly context: ExecutionContext,
  ) {}

  public dispatch<TPayload>(
    job: JobDefinition<TPayload>,
    payload: TPayload,
    options?: DispatchOptions,
  ): Promise<DispatchedJob> {
    return this.dispatcher.dispatch(job, job.parse(payload), options);
  }

  public afterCommit<TPayload>(
    job: JobDefinition<TPayload>,
    payload: TPayload,
    options?: DispatchOptions,
  ): void {
    const parsed = job.parse(payload);
    this.context.afterCommit(async () => {
      await this.dispatcher.dispatch(job, parsed, options);
    });
  }

  public chain(jobs: readonly JobInvocation[]): Promise<readonly DispatchedJob[]> {
    return this.dispatcher.chain(jobs);
  }

  public batch(jobs: readonly JobInvocation[]): Promise<readonly DispatchedJob[]> {
    return this.dispatcher.batch(jobs);
  }

  public retryFailed(id: string): Promise<DispatchedJob> {
    return this.dispatcher.retryFailed(id);
  }
}
