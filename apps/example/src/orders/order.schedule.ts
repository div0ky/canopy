import { Inject, JobHandler, Schedule, type HandlesJob } from '@evergreen/canopy';
import { CloseStaleOrdersJob } from '@evergreen/canopy-jobs';
import { OrderStore } from './order.persistence.js';

type CloseStalePayload = ReturnType<typeof CloseStaleOrdersJob.parse>;

@JobHandler(CloseStaleOrdersJob)
export class CloseStaleOrdersHandler implements HandlesJob<CloseStalePayload> {
  public constructor(@Inject(OrderStore) private readonly orders: OrderStore) {}

  public async handle(payload: CloseStalePayload): Promise<void> {
    const olderThanHours = payload.olderThanHours ?? 24;
    const batchSize = payload.batchSize ?? 100;
    const olderThan = new Date(Date.now() - olderThanHours * 60 * 60 * 1_000);
    for (const order of await this.orders.stale(olderThan, batchSize)) {
      order.cancelAsStale();
      await this.orders.save(order);
    }
  }
}

export class OrderSchedules {
  @Schedule({
    id: 'orders.close-stale.hourly',
    job: CloseStaleOrdersJob,
    payload: { olderThanHours: 24, batchSize: 100 },
    cron: '0 * * * *',
    timezone: 'UTC',
    overlap: 'skip',
    enabled: true,
  })
  public closeStaleOrders(): void {}
}
