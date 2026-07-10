import type { Notification } from '@evergreen/canopy';

export class OrderCreatedNotification implements Notification<Record<string, unknown>> {
  public readonly name = 'order-created';

  public constructor(
    private readonly orderId: string,
    private readonly number: string,
  ) {}

  public via(): readonly ['database', 'broadcast'] {
    return ['database', 'broadcast'] as const;
  }

  public toDatabase(): Record<string, unknown> {
    return { orderId: this.orderId, number: this.number };
  }

  public toBroadcast(): Record<string, unknown> {
    return { orderId: this.orderId, number: this.number };
  }
}
