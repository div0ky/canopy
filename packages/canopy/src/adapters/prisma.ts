import { Injectable } from '@nestjs/common';
import { Prisma, type DatabaseClient } from '@evergreen/db';
import type { DomainEvent } from '../events/events.js';
import type { ClaimedOutboxMessage, OutboxRepository } from '../outbox/outbox-publisher.js';
import type {
  EventJournal,
  Outbox,
  OutboxMessage,
  TransactionManager,
} from '../persistence/ports.js';

type Transaction = Prisma.TransactionClient;

@Injectable()
export class PrismaTransactionManager implements TransactionManager<Transaction> {
  public constructor(private readonly database: DatabaseClient) {}

  public run<TResult>(operation: (transaction: Transaction) => Promise<TResult>): Promise<TResult> {
    return this.database.$transaction(operation, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
  }
}

@Injectable()
export class PrismaEventJournal implements EventJournal<Transaction> {
  public async append(events: readonly DomainEvent[], transaction: Transaction): Promise<void> {
    if (events.length === 0) return;
    await transaction.domainEventJournal.createMany({
      data: events.map((event) => ({
        id: event.id,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        aggregateVersion: event.aggregateVersion,
        eventType: event.type,
        eventVersion: event.version,
        payload: event.payload as Prisma.InputJsonValue,
        metadata: event.metadata as Prisma.InputJsonValue,
        occurredAt: event.occurredAt,
      })),
    });
  }
}

interface OutboxRow {
  id: string;
  topic: string;
  event_type: string;
  event_version: number;
  payload: Prisma.JsonValue;
  metadata: Prisma.JsonValue;
  attempts: number;
  available_at: Date;
}

@Injectable()
export class PrismaOutbox implements Outbox<Transaction>, OutboxRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async append(messages: readonly OutboxMessage[], transaction: Transaction): Promise<void> {
    if (messages.length === 0) return;
    await transaction.frameworkOutbox.createMany({
      data: messages.map((message) => ({
        id: message.id,
        topic: message.topic,
        eventType: message.eventType,
        eventVersion: message.eventVersion,
        payload: message.payload as Prisma.InputJsonValue,
        metadata: message.metadata as Prisma.InputJsonValue,
        ...(message.availableAt ? { availableAt: message.availableAt } : {}),
      })),
    });
  }

  public claim(options: {
    workerId: string;
    limit: number;
    leaseMs: number;
  }): Promise<readonly ClaimedOutboxMessage[]> {
    return this.database.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<OutboxRow[]>(Prisma.sql`
        UPDATE framework_outbox AS outbox
        SET status = 'processing'::"OutboxStatus",
            locked_at = NOW(),
            locked_by = ${options.workerId},
            lease_expires_at = NOW() + (${options.leaseMs} * INTERVAL '1 millisecond'),
            attempts = outbox.attempts + 1,
            updated_at = NOW()
        FROM (
          SELECT id
          FROM framework_outbox
          WHERE available_at <= NOW()
            AND (
              status = 'pending'::"OutboxStatus"
              OR (status = 'processing'::"OutboxStatus" AND lease_expires_at < NOW())
            )
          ORDER BY available_at, created_at
          FOR UPDATE SKIP LOCKED
          LIMIT ${options.limit}
        ) AS claimable
        WHERE outbox.id = claimable.id
        RETURNING outbox.id, outbox.topic, outbox.event_type, outbox.event_version,
                  outbox.payload, outbox.metadata, outbox.attempts, outbox.available_at
      `);
      return rows.map((row) => this.mapRow(row));
    });
  }

  public async published(id: string): Promise<void> {
    await this.database.frameworkOutbox.update({
      where: { id },
      data: {
        status: 'published',
        publishedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        leaseExpiresAt: null,
        lastError: null,
      },
    });
  }

  public async failed(
    id: string,
    error: Error,
    options: { maxAttempts: number; baseDelayMs: number },
  ): Promise<void> {
    const row = await this.database.frameworkOutbox.findUniqueOrThrow({ where: { id } });
    const dead = row.attempts >= options.maxAttempts;
    const delayMs = options.baseDelayMs * 2 ** Math.max(0, row.attempts - 1);
    await this.database.frameworkOutbox.update({
      where: { id },
      data: {
        status: dead ? 'dead' : 'pending',
        availableAt: dead ? row.availableAt : new Date(Date.now() + delayMs),
        lockedAt: null,
        lockedBy: null,
        leaseExpiresAt: null,
        lastError: error.stack ?? error.message,
      },
    });
  }

  public async retry(id: string): Promise<void> {
    await this.database.frameworkOutbox.update({
      where: { id },
      data: {
        status: 'pending',
        attempts: 0,
        availableAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        leaseExpiresAt: null,
        lastError: null,
      },
    });
  }

  public async list(
    status?: 'pending' | 'processing' | 'published' | 'dead',
  ): Promise<readonly ClaimedOutboxMessage[]> {
    const rows = await this.database.frameworkOutbox.findMany({
      ...(status ? { where: { status } } : {}),
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((row) => ({
      id: row.id,
      topic: row.topic,
      eventType: row.eventType,
      eventVersion: row.eventVersion,
      payload: this.record(row.payload),
      metadata: this.record(row.metadata),
      attempts: row.attempts,
      availableAt: row.availableAt,
    }));
  }

  private mapRow(row: OutboxRow): ClaimedOutboxMessage {
    return {
      id: row.id,
      topic: row.topic,
      eventType: row.event_type,
      eventVersion: row.event_version,
      payload: this.record(row.payload),
      metadata: this.record(row.metadata),
      attempts: row.attempts,
      availableAt: row.available_at,
    };
  }

  private record(value: Prisma.JsonValue): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { value };
  }
}
