import { randomUUID } from 'node:crypto';
import { DomainModel, type ModelSnapshot } from '@evergreen/canopy';
import { OrderCreatedEvent, OrderUpdatedEvent, type OrderEventPayload } from './order.events.js';

export type OrderStatus = 'draft' | 'submitted' | 'paid' | 'cancelled';

export interface OrderAttributes extends Record<string, unknown> {
  userId: string;
  number: string;
  status: OrderStatus;
  totalCents: number;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOrderAttributes {
  readonly userId: string;
  readonly totalCents: number;
  readonly notes?: string;
}

export class Order extends DomainModel<string, OrderAttributes> {
  public constructor(snapshot: ModelSnapshot<string, OrderAttributes>, persisted = true) {
    super(snapshot, persisted);
  }

  public static create(input: CreateOrderAttributes): Order {
    if (input.totalCents <= 0) throw new Error('Order total must be positive');
    const now = new Date();
    const order = new Order(
      {
        id: randomUUID(),
        version: 0,
        attributes: {
          userId: input.userId,
          number: `ORD-${now.getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`,
          status: 'draft',
          totalCents: input.totalCents,
          notes: input.notes ?? null,
          createdAt: now,
          updatedAt: now,
        },
      },
      false,
    );
    order.record(
      OrderCreatedEvent.create({
        aggregateType: 'Order',
        aggregateId: order.id,
        aggregateVersion: 1,
        payload: order.eventPayload(),
      }),
    );
    return order;
  }

  public static hydrate(input: {
    id: string;
    version: number;
    attributes: OrderAttributes;
    deleted?: boolean;
  }): Order {
    const order = new Order({ id: input.id, version: input.version, attributes: input.attributes });
    if (input.deleted) order.markDeleted(input.version);
    return order;
  }

  public get userId(): string {
    return this.get('userId');
  }
  public get number(): string {
    return this.get('number');
  }
  public get status(): OrderStatus {
    return this.get('status');
  }
  public get totalCents(): number {
    return this.get('totalCents');
  }
  public get notes(): string | null {
    return this.get('notes');
  }
  public get createdAt(): Date {
    return this.get('createdAt');
  }
  public get updatedAt(): Date {
    return this.get('updatedAt');
  }

  public update(input: { status?: OrderStatus; totalCents?: number; notes?: string | null }): void {
    if (input.totalCents !== undefined && input.totalCents <= 0) {
      throw new Error('Order total must be positive');
    }
    if (this.status === 'cancelled' && input.status && input.status !== 'cancelled') {
      throw new Error('Cancelled orders cannot transition to another status');
    }
    const patch: Partial<OrderAttributes> = { updatedAt: new Date() };
    if (input.status !== undefined) patch.status = input.status;
    if (input.totalCents !== undefined) patch.totalCents = input.totalCents;
    if (input.notes !== undefined) patch.notes = input.notes;
    this.set(patch);
    const changed = Object.keys(this.dirty).filter((key) => key !== 'updatedAt');
    if (changed.length > 0) {
      this.record(
        OrderUpdatedEvent.create({
          aggregateType: 'Order',
          aggregateId: this.id,
          aggregateVersion: this.version + 1,
          payload: { ...this.eventPayload(), changed },
        }),
      );
    }
  }

  public cancelAsStale(): void {
    if (this.status === 'draft' || this.status === 'submitted')
      this.update({ status: 'cancelled' });
  }

  private eventPayload(): OrderEventPayload {
    return {
      orderId: this.id,
      userId: this.userId,
      number: this.number,
      status: this.status,
      totalCents: this.totalCents,
      notes: this.notes,
    };
  }
}
