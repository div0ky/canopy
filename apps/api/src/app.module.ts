import { Module } from '@nestjs/common';
import {
  ExampleModule,
  CreateOrderAction,
  GetOrderQuery,
  ListOrdersQuery,
  UpdateOrderAction,
} from '@canopy/example';
import { CanopyModule } from '@evergreen/canopy';
import { ApiController } from './api.controller.js';
import { OrdersGateway } from './orders.gateway.js';
import { canopyOptions } from './runtime.js';

@Module({
  imports: [
    CanopyModule.forRootAsync({
      imports: [ExampleModule],
      useFactory: () => ({
        ...canopyOptions,
        actions: [CreateOrderAction, UpdateOrderAction],
        queries: [GetOrderQuery, ListOrdersQuery],
      }),
    }),
  ],
  controllers: [ApiController],
  providers: [OrdersGateway],
})
export class AppModule {}
