import {
  Broadcasting,
  Inject,
  Listener,
  Log,
  Notifications,
  type DomainEvent,
  type HandlesEvent,
} from '@evergreen/canopy';
import { OrderCreatedEvent, OrderUpdatedEvent, type OrderEventPayload } from './order.events.js';
import { OrderCreatedNotification } from './order.notification.js';

@Listener(OrderCreatedEvent, { queued: true })
export class SendOrderCreatedNotification implements HandlesEvent<OrderEventPayload> {
  public constructor(
    @Inject(Notifications) private readonly notifications: Notifications,
    @Inject(Broadcasting) private readonly broadcasting: Broadcasting,
  ) {}

  public async handle(event: DomainEvent<OrderEventPayload>): Promise<void> {
    await this.notifications.send(
      { id: event.payload.userId },
      new OrderCreatedNotification(event.payload.orderId, event.payload.number),
    );
    await this.broadcasting.broadcast({
      channel: `orders.${event.payload.userId}`,
      event: 'order.created',
      payload: event.payload,
    });
  }
}

@Listener(OrderUpdatedEvent)
export class AuditOrderUpdated implements HandlesEvent<OrderEventPayload & { changed: string[] }> {
  public constructor(@Inject(Log) private readonly log: Log) {}

  public handle(event: DomainEvent<OrderEventPayload & { changed: string[] }>): void {
    this.log.info('order.updated', {
      orderId: event.payload.orderId,
      changed: event.payload.changed,
      correlationId: event.metadata.correlationId,
    });
  }
}
