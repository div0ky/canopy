import { defineEvent } from '@evergreen/canopy';
import { z } from 'zod';

export const OrderEventPayloadSchema = z.object({
  orderId: z.string().uuid(),
  userId: z.string().uuid(),
  number: z.string(),
  status: z.enum(['draft', 'submitted', 'paid', 'cancelled']),
  totalCents: z.number().int().nonnegative(),
  notes: z.string().nullable(),
});

export type OrderEventPayload = z.infer<typeof OrderEventPayloadSchema>;

export const OrderCreatedEvent = defineEvent('order.created', 1, OrderEventPayloadSchema);

export const OrderUpdatedEvent = defineEvent(
  'order.updated',
  1,
  OrderEventPayloadSchema.extend({ changed: z.array(z.string()) }),
);
