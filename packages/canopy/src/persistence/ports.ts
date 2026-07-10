import type { DomainEvent } from '../events/events.js';
import type { DomainModel, ModelAttributes, ModelId } from '../models/domain-model.js';

export interface TransactionManager<TTransaction = unknown> {
  run<TResult>(operation: (transaction: TTransaction) => Promise<TResult>): Promise<TResult>;
}

export interface EventJournal<TTransaction = unknown> {
  append(events: readonly DomainEvent[], transaction: TTransaction): Promise<void>;
}

export interface OutboxMessage {
  readonly id: string;
  readonly topic: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly availableAt?: Date;
}

export interface Outbox<TTransaction = unknown> {
  append(messages: readonly OutboxMessage[], transaction: TTransaction): Promise<void>;
}

export interface ModelPersistenceAdapter<
  TModel extends DomainModel<TId, TAttributes>,
  TId extends ModelId,
  TAttributes extends ModelAttributes,
  TTransaction = unknown,
> {
  find(id: TId, transaction?: TTransaction): Promise<TModel | null>;
  create(model: TModel, transaction: TTransaction): Promise<number>;
  update(model: TModel, expectedVersion: number, transaction: TTransaction): Promise<number>;
  delete(model: TModel, expectedVersion: number, transaction: TTransaction): Promise<number>;
  restore(model: TModel, expectedVersion: number, transaction: TTransaction): Promise<number>;
}
