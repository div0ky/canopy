import { randomUUID } from 'node:crypto';
import type { ZodType } from 'zod';
import { FrameworkRegistry, type ConcreteConstructor } from '../registry/framework-registry.js';

export interface EventMetadata {
  readonly actorId?: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly traceId?: string;
  readonly locale?: string;
  readonly [key: string]: unknown;
}

export interface DomainEvent<TPayload = Readonly<Record<string, unknown>>> {
  readonly id: string;
  readonly type: string;
  readonly version: number;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly payload: TPayload;
  readonly metadata: EventMetadata;
  readonly occurredAt: Date;
}

export interface EventDefinition<TPayload> {
  readonly name: string;
  readonly version: number;
  readonly schema: ZodType<TPayload>;
  create(input: {
    aggregateType: string;
    aggregateId: string;
    aggregateVersion: number;
    payload: TPayload;
    metadata?: EventMetadata;
    occurredAt?: Date;
    id?: string;
  }): DomainEvent<TPayload>;
}

export function defineEvent<TPayload>(
  name: string,
  version: number,
  schema: ZodType<TPayload>,
): EventDefinition<TPayload> {
  if (version < 1 || !Number.isInteger(version)) {
    throw new Error(`Event ${name} must have a positive integer version`);
  }
  return Object.freeze({
    name,
    version,
    schema,
    create: (input: Parameters<EventDefinition<TPayload>['create']>[0]) => ({
      id: input.id ?? randomUUID(),
      type: name,
      version,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      aggregateVersion: input.aggregateVersion,
      payload: schema.parse(input.payload),
      metadata: input.metadata ?? {},
      occurredAt: input.occurredAt ?? new Date(),
    }),
  });
}

export interface ListenerOptions {
  readonly queued?: boolean;
}

export function Listener(
  event: string | EventDefinition<unknown>,
  options: ListenerOptions = {},
): ClassDecorator {
  return (target) => {
    FrameworkRegistry.registerListener({
      event: typeof event === 'string' ? event : event.name,
      listener: target as unknown as ConcreteConstructor,
      queued: options.queued ?? false,
    });
  };
}

export interface HandlesEvent<TPayload = Readonly<Record<string, unknown>>> {
  handle(event: DomainEvent<TPayload>): void | Promise<void>;
}
