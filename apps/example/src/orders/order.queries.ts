import {
  Authorization,
  ExecutionContext,
  Inject,
  Query,
  QueryHandler,
  decodeCursor,
  encodeCursor,
  type CursorPage,
  type Handles,
} from '@evergreen/canopy';
import type { OrderResource as OrderOutput } from '@evergreen/canopy-contracts';
import { OrderStore } from './order.persistence.js';
import { OrderResource } from './order.resource.js';

export class GetOrderQuery extends Query<OrderOutput> {
  public constructor(public readonly id: string) {
    super();
  }
}

@QueryHandler(GetOrderQuery)
export class GetOrderHandler implements Handles<GetOrderQuery, OrderOutput> {
  readonly #resource = new OrderResource();

  public constructor(
    @Inject(ExecutionContext) private readonly context: ExecutionContext,
    @Inject(OrderStore) private readonly orders: OrderStore,
    @Inject(Authorization) private readonly authorization: Authorization,
  ) {}

  public async handle(query: GetOrderQuery): Promise<OrderOutput> {
    const actor = this.context.current().actor;
    if (!actor) throw new Error('An authenticated actor is required');
    const order = await this.orders.findOrFail(query.id);
    await this.authorization.authorize(actor, 'view', order);
    return this.#resource.serialize(order);
  }
}

export class ListOrdersQuery extends Query<CursorPage<OrderOutput>> {
  public constructor(
    public readonly after: string | undefined,
    public readonly limit: number,
  ) {
    super();
  }
}

@QueryHandler(ListOrdersQuery)
export class ListOrdersHandler implements Handles<ListOrdersQuery, CursorPage<OrderOutput>> {
  readonly #resource = new OrderResource();

  public constructor(
    @Inject(ExecutionContext) private readonly context: ExecutionContext,
    @Inject(OrderStore) private readonly orders: OrderStore,
  ) {}

  public async handle(query: ListOrdersQuery): Promise<CursorPage<OrderOutput>> {
    const actor = this.context.current().actor;
    if (!actor || actor.type !== 'user') throw new Error('An authenticated user is required');
    const rows = await this.orders.list({
      userId: actor.id,
      ...(query.after ? { cursor: decodeCursor(query.after) } : {}),
      limit: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      data: this.#resource.collection(page),
      meta: {
        hasMore,
        nextCursor:
          hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
      },
    };
  }
}
