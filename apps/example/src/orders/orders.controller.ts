import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query as HttpQuery,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ActionBus,
  CanopyAuthGuard,
  CanopyContextInterceptor,
  Inject,
  QueryBus,
  type CursorPage,
  validate,
} from '@evergreen/canopy';
import {
  CreateOrderRequestSchema,
  CursorSchema,
  UpdateOrderRequestSchema,
  type OrderResource as OrderOutput,
} from '@evergreen/canopy-contracts';
import { CreateOrderAction, UpdateOrderAction } from './order.actions.js';
import { GetOrderQuery, ListOrdersQuery } from './order.queries.js';
import { OrderResource } from './order.resource.js';

@Controller('orders')
@UseGuards(CanopyAuthGuard)
@UseInterceptors(CanopyContextInterceptor)
export class OrdersController {
  readonly #resource = new OrderResource();

  public constructor(
    @Inject(ActionBus) private readonly actions: ActionBus,
    @Inject(QueryBus) private readonly queries: QueryBus,
  ) {}

  @Post()
  public async create(@Body() input: unknown): Promise<{ data: OrderOutput }> {
    const body = validate(CreateOrderRequestSchema, input);
    const order = await this.actions.execute(new CreateOrderAction(body.totalCents, body.notes));
    return this.#resource.item(order);
  }

  @Patch(':id')
  public async update(
    @Param('id') id: string,
    @Body() input: unknown,
  ): Promise<{ data: OrderOutput }> {
    const body = validate(UpdateOrderRequestSchema, input);
    const order = await this.actions.execute(
      new UpdateOrderAction(id, body.version, {
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.totalCents !== undefined ? { totalCents: body.totalCents } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
      }),
    );
    return this.#resource.item(order);
  }

  @Get(':id')
  public async show(@Param('id') id: string): Promise<{ data: OrderOutput }> {
    return { data: await this.queries.execute(new GetOrderQuery(id)) };
  }

  @Get()
  public list(@HttpQuery() input: unknown): Promise<CursorPage<OrderOutput>> {
    const query = validate(CursorSchema, input);
    return this.queries.execute(new ListOrdersQuery(query.after, query.limit ?? 25));
  }
}
