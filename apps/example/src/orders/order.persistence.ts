import { Inject, Injectable } from '@nestjs/common';
import {
  ModelManager,
  ObserverRegistry,
  UnitOfWork,
  type Cursor,
  type ModelPersistenceAdapter,
} from '@evergreen/canopy';
import { Order, type OrderAttributes } from './order.model.js';

export const ORDER_PERSISTENCE = Symbol('ORDER_PERSISTENCE');

export interface OrderPersistence extends ModelPersistenceAdapter<Order, string, OrderAttributes> {
  list(input: { userId: string; cursor?: Cursor; limit: number }): Promise<readonly Order[]>;
  stale(olderThan: Date, limit: number): Promise<readonly Order[]>;
  attach(input: {
    orderId: string;
    disk: string;
    path: string;
    contentType: string;
    size: number;
  }): Promise<void>;
}

@Injectable()
export class OrderStore {
  readonly #manager: ModelManager<Order, string, OrderAttributes>;

  public constructor(
    @Inject(ORDER_PERSISTENCE) private readonly persistence: OrderPersistence,
    @Inject(UnitOfWork) unitOfWork: UnitOfWork,
    @Inject(ObserverRegistry) observers: ObserverRegistry,
  ) {
    this.#manager = new ModelManager('Order', persistence, unitOfWork, observers);
  }

  public find(id: string): Promise<Order | null> {
    return this.#manager.find(id);
  }
  public findOrFail(id: string): Promise<Order> {
    return this.#manager.findOrFail(id);
  }
  public save(order: Order): Promise<Order> {
    return this.#manager.save(order);
  }
  public delete(order: Order): Promise<Order> {
    return this.#manager.delete(order);
  }
  public restore(order: Order): Promise<Order> {
    return this.#manager.restore(order);
  }
  public list(input: {
    userId: string;
    cursor?: Cursor;
    limit: number;
  }): Promise<readonly Order[]> {
    return this.persistence.list(input);
  }
  public stale(olderThan: Date, limit: number): Promise<readonly Order[]> {
    return this.persistence.stale(olderThan, limit);
  }
  public attach(input: {
    orderId: string;
    disk: string;
    path: string;
    contentType: string;
    size: number;
  }): Promise<void> {
    return this.persistence.attach(input);
  }
}
