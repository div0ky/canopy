import { Module } from '@nestjs/common';
import {
  ExampleModule,
  CreateOrderAction,
  GetOrderQuery,
  ListOrdersQuery,
  UpdateOrderAction,
} from '@canopy/example';
import { CanopyModule } from '@evergreen/canopy';
import { canopyOptions } from './runtime.js';
import { OutboxPump, QueueWorkers } from './worker.services.js';

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
  providers: [QueueWorkers, OutboxPump],
})
export class WorkerModule {}
