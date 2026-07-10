import { describe, expect, it } from 'vitest';
import { Contracts, OrderRealtimeEventSchema } from './index.js';

describe('shared API contracts', () => {
  it('validates HTTP requests identically for API and clients', () => {
    expect(Contracts.orders.create.request.parse({ totalCents: 2500 })).toEqual({
      totalCents: 2500,
    });
    expect(() => Contracts.orders.create.request.parse({ totalCents: 0 })).toThrow();
  });

  it('validates versioned realtime events', () => {
    const event = {
      type: 'order.created',
      version: 1,
      eventId: '00000000-0000-4000-8000-000000000001',
      occurredAt: '2026-07-10T12:00:00.000Z',
      order: {
        id: '00000000-0000-4000-8000-000000000002',
        userId: '00000000-0000-4000-8000-000000000001',
        number: 'ORD-1',
        status: 'draft',
        totalCents: 2500,
        notes: null,
        version: 1,
        createdAt: '2026-07-10T12:00:00.000Z',
        updatedAt: '2026-07-10T12:00:00.000Z',
      },
    };
    expect(OrderRealtimeEventSchema.parse(event)).toEqual(event);
  });
});
