import { PolicyFor, type Actor, type Policy } from '@evergreen/canopy';
import { Order } from './order.model.js';

@PolicyFor(Order)
export class OrderPolicy implements Policy<Order> {
  public allows(actor: Actor, ability: string, order: Order): boolean {
    if (actor.roles?.includes('admin')) return true;
    return order.userId === actor.id && ['view', 'update', 'delete', 'attach'].includes(ability);
  }
}
