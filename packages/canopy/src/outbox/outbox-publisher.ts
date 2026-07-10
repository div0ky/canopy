import { Injectable } from '@nestjs/common';
import type { JobDefinition } from '@evergreen/canopy-jobs';
import { PublishEventJob } from '@evergreen/canopy-jobs';
import type { Jobs } from '../jobs/jobs.js';
import type { OutboxMessage } from '../persistence/ports.js';

export interface ClaimedOutboxMessage extends OutboxMessage {
  readonly attempts: number;
}

export interface OutboxRepository {
  claim(options: {
    workerId: string;
    limit: number;
    leaseMs: number;
  }): Promise<readonly ClaimedOutboxMessage[]>;
  published(id: string): Promise<void>;
  failed(
    id: string,
    error: Error,
    options: { maxAttempts: number; baseDelayMs: number },
  ): Promise<void>;
  retry(id: string): Promise<void>;
  list(
    status?: 'pending' | 'processing' | 'published' | 'dead',
  ): Promise<readonly ClaimedOutboxMessage[]>;
}

export interface OutboxPublisherOptions {
  readonly workerId: string;
  readonly batchSize: number;
  readonly leaseMs: number;
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
}

@Injectable()
export class OutboxPublisher {
  public constructor(
    private readonly repository: OutboxRepository,
    private readonly jobs: Jobs,
  ) {}

  public async publishOnce(options: OutboxPublisherOptions): Promise<number> {
    const messages = await this.repository.claim({
      workerId: options.workerId,
      limit: options.batchSize,
      leaseMs: options.leaseMs,
    });
    for (const message of messages) {
      try {
        await this.jobs.dispatch(
          PublishEventJob as JobDefinition<{
            outboxId: string;
            eventType: string;
            eventVersion: number;
            payload: Record<string, unknown>;
            metadata: Record<string, unknown>;
          }>,
          {
            outboxId: message.id,
            eventType: message.eventType,
            eventVersion: message.eventVersion,
            payload: { ...message.payload },
            metadata: { ...message.metadata },
          },
          { deduplicationId: message.id },
        );
        await this.repository.published(message.id);
      } catch (error) {
        await this.repository.failed(
          message.id,
          error instanceof Error ? error : new Error(String(error)),
          { maxAttempts: options.maxAttempts, baseDelayMs: options.baseDelayMs },
        );
      }
    }
    return messages.length;
  }
}
