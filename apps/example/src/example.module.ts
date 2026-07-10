import { Module } from '@nestjs/common';
import { PrismaOrderPersistence } from './composition/prisma-order.persistence.js';
import { ORDER_PERSISTENCE, OrderStore } from './orders/order.persistence.js';
import { OrdersController } from './orders/orders.controller.js';
import './orders/order.listeners.js';
import './orders/order.observer.js';
import './orders/order.policy.js';
import './orders/order.schedule.js';

@Module({
  controllers: [OrdersController],
  providers: [OrderStore, { provide: ORDER_PERSISTENCE, useClass: PrismaOrderPersistence }],
  exports: [OrderStore, ORDER_PERSISTENCE],
})
export class ExampleModule {}
