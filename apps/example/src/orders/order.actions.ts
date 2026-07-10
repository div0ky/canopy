import {
  Action,
  ActionHandler,
  Authorization,
  ExecutionContext,
  Inject,
  StorageManager,
  type Handles,
} from '@evergreen/canopy';
import { Order, type OrderStatus } from './order.model.js';
import { OrderStore } from './order.persistence.js';

export interface OrderAttachmentInput {
  readonly filename: string;
  readonly contents: Uint8Array;
  readonly contentType: string;
}

export class CreateOrderAction extends Action<Order> {
  public constructor(
    public readonly totalCents: number,
    public readonly notes?: string,
    public readonly attachment?: OrderAttachmentInput,
  ) {
    super();
  }
}

@ActionHandler(CreateOrderAction)
export class CreateOrderHandler implements Handles<CreateOrderAction, Order> {
  public constructor(
    @Inject(ExecutionContext) private readonly context: ExecutionContext,
    @Inject(OrderStore) private readonly orders: OrderStore,
    @Inject(Authorization) private readonly authorization: Authorization,
    @Inject(StorageManager) private readonly storage: StorageManager,
  ) {}

  public async handle(action: CreateOrderAction): Promise<Order> {
    const actor = this.context.current().actor;
    if (!actor || actor.type !== 'user') throw new Error('An authenticated user is required');
    const order = Order.create({
      userId: actor.id,
      totalCents: action.totalCents,
      ...(action.notes ? { notes: action.notes } : {}),
    });
    await this.authorization.authorize(actor, 'update', order);
    if (action.attachment) {
      const attachment = action.attachment;
      this.context.afterCommit(async () => {
        const safeName = attachment.filename.replace(/[^a-zA-Z0-9._-]/g, '-');
        const path = `orders/${order.id}/${safeName}`;
        const stored = await this.storage.disk().put(path, attachment.contents, {
          contentType: attachment.contentType,
          visibility: 'private',
        });
        await this.orders.attach({
          orderId: order.id,
          disk: stored.disk,
          path: stored.path,
          contentType: attachment.contentType,
          size: stored.size,
        });
      });
    }
    return this.orders.save(order);
  }
}

export class UpdateOrderAction extends Action<Order> {
  public constructor(
    public readonly id: string,
    public readonly expectedVersion: number,
    public readonly patch: { status?: OrderStatus; totalCents?: number; notes?: string | null },
  ) {
    super();
  }
}

@ActionHandler(UpdateOrderAction)
export class UpdateOrderHandler implements Handles<UpdateOrderAction, Order> {
  public constructor(
    @Inject(ExecutionContext) private readonly context: ExecutionContext,
    @Inject(OrderStore) private readonly orders: OrderStore,
    @Inject(Authorization) private readonly authorization: Authorization,
  ) {}

  public async handle(action: UpdateOrderAction): Promise<Order> {
    const actor = this.context.current().actor;
    if (!actor) throw new Error('An authenticated actor is required');
    const order = await this.orders.findOrFail(action.id);
    await this.authorization.authorize(actor, 'update', order);
    if (order.version !== action.expectedVersion) {
      throw new Error(
        `Expected order version ${action.expectedVersion}, received ${order.version}`,
      );
    }
    order.update(action.patch);
    return this.orders.save(order);
  }
}
