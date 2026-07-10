import { Resource } from '@evergreen/canopy';
import type { OrderResource as OrderOutput } from '@evergreen/canopy-contracts';
import type { Order } from './order.model.js';

export class OrderResource extends Resource<Order, OrderOutput> {
  public serialize(order: Order): OrderOutput {
    return {
      id: order.id,
      userId: order.userId,
      number: order.number,
      status: order.status,
      totalCents: order.totalCents,
      notes: order.notes,
      version: order.version,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };
  }
}
