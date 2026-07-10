import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { BullWorkerHost } from '@evergreen/canopy/adapters';
import { ExecutionContext, Jobs, OutboxPublisher } from '@evergreen/canopy';
import { jobs, outbox, redis } from './runtime.js';

@Injectable()
export class QueueWorkers implements OnModuleInit, OnModuleDestroy {
  readonly #host: BullWorkerHost;

  public constructor(
    @Inject(ModuleRef) moduleRef: ModuleRef,
    @Inject(ExecutionContext) context: ExecutionContext,
  ) {
    this.#host = new BullWorkerHost(redis, moduleRef, context);
  }

  public onModuleInit(): Promise<void> {
    return this.#host.onModuleInit();
  }
  public onModuleDestroy(): Promise<void> {
    return this.#host.onModuleDestroy();
  }
}

@Injectable()
export class OutboxPump implements OnModuleInit, OnModuleDestroy {
  readonly #publisher: OutboxPublisher;
  #timer?: NodeJS.Timeout;
  #publishing = false;

  public constructor(@Inject(Jobs) jobBus: Jobs) {
    this.#publisher = new OutboxPublisher(outbox, jobBus);
  }

  public onModuleInit(): void {
    this.#timer = setInterval(() => {
      void this.tick();
    }, 250);
    this.#timer.unref();
    void this.tick();
  }

  public onModuleDestroy(): void {
    if (this.#timer) clearInterval(this.#timer);
  }

  private async tick(): Promise<void> {
    if (this.#publishing) return;
    this.#publishing = true;
    try {
      await this.#publisher.publishOnce({
        workerId: `worker-${process.pid}`,
        batchSize: 100,
        leaseMs: 30_000,
        maxAttempts: 10,
        baseDelayMs: 1_000,
      });
    } finally {
      this.#publishing = false;
    }
  }
}

export async function closeWorkerResources(): Promise<void> {
  await jobs.onModuleDestroy();
  await redis.quit();
}
