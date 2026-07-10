import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ExecutionContext } from '../context/execution-context.js';
import type { DomainEvent } from '../events/events.js';
import { EventDispatcher } from '../events/event-dispatcher.js';
import type { DomainModel, ModelAttributes, ModelId } from '../models/domain-model.js';
import { ObserverRegistry, type AnyModel, type ModelObserver } from '../models/observers.js';
import { CANOPY_JOURNAL, CANOPY_OUTBOX, CANOPY_TRANSACTION_MANAGER } from '../tokens.js';
import type {
  EventJournal,
  ModelPersistenceAdapter,
  Outbox,
  OutboxMessage,
  TransactionManager,
} from './ports.js';

type WriteKind = 'create' | 'update' | 'delete' | 'restore';

@Injectable()
export class UnitOfWork {
  public constructor(
    @Inject(CANOPY_TRANSACTION_MANAGER)
    private readonly transactions: TransactionManager,
    @Inject(CANOPY_JOURNAL) private readonly journal: EventJournal,
    @Inject(CANOPY_OUTBOX) private readonly outbox: Outbox,
    @Inject(ExecutionContext) private readonly context: ExecutionContext,
    @Inject(ObserverRegistry) private readonly observers: ObserverRegistry,
    @Inject(EventDispatcher) private readonly events: EventDispatcher,
  ) {}

  public async persist<
    TModel extends DomainModel<TId, TAttributes>,
    TId extends ModelId,
    TAttributes extends ModelAttributes,
  >(
    model: TModel,
    adapter: ModelPersistenceAdapter<TModel, TId, TAttributes>,
    kind?: WriteKind,
  ): Promise<TModel> {
    const operation = async (): Promise<TModel> => {
      const resolvedKind = kind ?? (model.exists ? 'update' : 'create');
      const before = this.beforeLifecycles(resolvedKind);
      const after = this.afterLifecycles(resolvedKind);
      const previousVersion = model.version;
      let nextVersion = previousVersion;

      await this.transactions.run(async (transaction) => {
        await this.context.withTransaction(transaction, async () => {
          for (const lifecycle of before) {
            await this.observers.dispatch(model as unknown as AnyModel, lifecycle);
          }

          nextVersion = await this.write(
            resolvedKind,
            model,
            adapter,
            previousVersion,
            transaction,
          );

          for (const lifecycle of after) {
            await this.observers.dispatch(model as unknown as AnyModel, lifecycle);
          }

          const events = model.events().map((event) => this.enrich(event, nextVersion));
          await this.events.dispatchLocal(events);
          await this.journal.append(events, transaction);
          await this.outbox.append(
            events.map((event) => this.toOutbox(event)),
            transaction,
          );
        });
      });

      if (resolvedKind === 'delete') {
        model.markDeleted(nextVersion);
      } else if (resolvedKind === 'restore') {
        model.markRestored(nextVersion);
      } else {
        model.markPersisted(nextVersion);
      }
      await this.observers.dispatch(model as unknown as AnyModel, 'committed');
      await this.context.flushAfterCommit();
      return model;
    };

    return this.context.active ? operation() : this.context.run({}, operation);
  }

  private beforeLifecycles(kind: WriteKind): Array<keyof ModelObserver<AnyModel>> {
    switch (kind) {
      case 'create':
        return ['creating', 'saving'];
      case 'update':
        return ['updating', 'saving'];
      case 'delete':
        return ['deleting'];
      case 'restore':
        return ['restoring'];
    }
  }

  private afterLifecycles(kind: WriteKind): Array<keyof ModelObserver<AnyModel>> {
    switch (kind) {
      case 'create':
        return ['created', 'saved'];
      case 'update':
        return ['updated', 'saved'];
      case 'delete':
        return ['deleted'];
      case 'restore':
        return ['restored'];
    }
  }

  private async write<
    TModel extends DomainModel<TId, TAttributes>,
    TId extends ModelId,
    TAttributes extends ModelAttributes,
  >(
    kind: WriteKind,
    model: TModel,
    adapter: ModelPersistenceAdapter<TModel, TId, TAttributes>,
    expectedVersion: number,
    transaction: unknown,
  ): Promise<number> {
    switch (kind) {
      case 'create':
        return adapter.create(model, transaction);
      case 'update':
        return adapter.update(model, expectedVersion, transaction);
      case 'delete':
        return adapter.delete(model, expectedVersion, transaction);
      case 'restore':
        return adapter.restore(model, expectedVersion, transaction);
    }
  }

  private enrich(event: DomainEvent, aggregateVersion: number): DomainEvent {
    const context = this.context.current();
    return {
      ...event,
      aggregateVersion,
      metadata: {
        ...event.metadata,
        correlationId: context.correlationId,
        traceId: context.traceId,
        locale: context.locale,
        ...(context.actor ? { actorId: context.actor.id, actorType: context.actor.type } : {}),
        ...(context.causationId ? { causationId: context.causationId } : {}),
      },
    };
  }

  private toOutbox(event: DomainEvent): OutboxMessage {
    return {
      id: randomUUID(),
      topic: 'events',
      eventType: event.type,
      eventVersion: event.version,
      payload: {
        eventId: event.id,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        aggregateVersion: event.aggregateVersion,
        occurredAt: event.occurredAt.toISOString(),
        payload: event.payload,
      },
      metadata: event.metadata,
    };
  }
}
