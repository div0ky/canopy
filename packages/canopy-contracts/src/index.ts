import { z } from 'zod';

export const IdentifierSchema = z.string().uuid();
export const IsoDateSchema = z.string().datetime({ offset: true });

export const CursorSchema = z.object({
  after: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const PaginationMetaSchema = z.object({
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export function dataEnvelope<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
): z.ZodObject<{
  data: TSchema;
  meta: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}> {
  return z.object({
    data: schema,
    meta: z.record(z.unknown()).optional(),
  });
}

export function pageEnvelope<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
): z.ZodObject<{
  data: z.ZodArray<TSchema>;
  meta: typeof PaginationMetaSchema;
}> {
  return z.object({
    data: z.array(schema),
    meta: PaginationMetaSchema,
  });
}

export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    correlationId: z.string().optional(),
  }),
});

export const UserResourceSchema = z.object({
  id: IdentifierSchema,
  email: z.string().email(),
  name: z.string(),
  createdAt: IsoDateSchema,
});

export const OrderStatusSchema = z.enum(['draft', 'submitted', 'paid', 'cancelled']);

export const OrderResourceSchema = z.object({
  id: IdentifierSchema,
  userId: IdentifierSchema,
  number: z.string(),
  status: OrderStatusSchema,
  totalCents: z.number().int().nonnegative(),
  notes: z.string().nullable(),
  version: z.number().int().positive(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});

export type OrderResource = z.infer<typeof OrderResourceSchema>;

export const CreateOrderRequestSchema = z.object({
  totalCents: z.number().int().positive(),
  notes: z.string().max(2_000).optional(),
});

export const UpdateOrderRequestSchema = z
  .object({
    status: OrderStatusSchema.optional(),
    totalCents: z.number().int().positive().optional(),
    notes: z.string().max(2_000).nullable().optional(),
    version: z.number().int().positive(),
  })
  .refine(
    ({ status, totalCents, notes }) =>
      status !== undefined || totalCents !== undefined || notes !== undefined,
    {
      message: 'At least one order field must be supplied',
    },
  );

export const OrderCreatedEventSchema = z.object({
  type: z.literal('order.created'),
  version: z.literal(1),
  eventId: IdentifierSchema,
  occurredAt: IsoDateSchema,
  order: OrderResourceSchema,
});

export const OrderUpdatedEventSchema = z.object({
  type: z.literal('order.updated'),
  version: z.literal(1),
  eventId: IdentifierSchema,
  occurredAt: IsoDateSchema,
  order: OrderResourceSchema,
  changed: z.array(z.string()),
});

export const OrderRealtimeEventSchema = z.discriminatedUnion('type', [
  OrderCreatedEventSchema,
  OrderUpdatedEventSchema,
]);

export const Contracts = {
  orders: {
    create: {
      method: 'POST',
      path: '/orders',
      request: CreateOrderRequestSchema,
      response: dataEnvelope(OrderResourceSchema),
    },
    update: {
      method: 'PATCH',
      path: '/orders/:id',
      request: UpdateOrderRequestSchema,
      response: dataEnvelope(OrderResourceSchema),
    },
    show: {
      method: 'GET',
      path: '/orders/:id',
      response: dataEnvelope(OrderResourceSchema),
    },
    index: {
      method: 'GET',
      path: '/orders',
      query: CursorSchema,
      response: pageEnvelope(OrderResourceSchema),
    },
  },
  websocket: {
    order: OrderRealtimeEventSchema,
  },
} as const;
