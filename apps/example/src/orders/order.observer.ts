import { CacheManager, Inject, Observer, type ModelObserver } from '@evergreen/canopy';
import { Order } from './order.model.js';

@Observer(Order)
export class OrderObserver implements ModelObserver<Order> {
  public constructor(@Inject(CacheManager) private readonly cache: CacheManager) {}

  public saving(order: Order): void {
    if (order.totalCents <= 0) throw new Error('Order total must be positive');
  }

  public async committed(order: Order): Promise<void> {
    await this.cache.flushTags([`order:${order.id}`, `orders:user:${order.userId}`]);
  }
}
