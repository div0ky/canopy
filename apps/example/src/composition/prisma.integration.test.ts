import { beforeEach, describe, expect, it } from 'vitest';
import { ExecutionContext, OptimisticLockError, UnitOfWork } from '@evergreen/canopy';
import type { EventDispatcher, ObserverRegistry } from '@evergreen/canopy';
import {
  PrismaEventJournal,
  PrismaOutbox,
  PrismaTransactionManager,
} from '@evergreen/canopy/adapters';
import { prisma } from '@evergreen/db';
import { Order } from '../orders/order.model.js';
import { PrismaOrderPersistence } from './prisma-order.persistence.js';

const integration = process.env['RUN_INTEGRATION'] === '1';
const userId = '00000000-0000-4000-8000-000000000001';

function unitOfWork(
  events: EventDispatcher = { dispatchLocal: async () => undefined } as unknown as EventDispatcher,
): UnitOfWork {
  return new UnitOfWork(
    new PrismaTransactionManager(prisma),
    new PrismaEventJournal(),
    new PrismaOutbox(prisma),
    new ExecutionContext(),
    { dispatch: async () => undefined } as unknown as ObserverRegistry,
    events,
  );
}

describe.skipIf(!integration)('PostgreSQL model, journal, and outbox integration', () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE notifications, order_attachments, framework_failed_jobs, framework_outbox, domain_event_journal, orders, users CASCADE',
    );
    await prisma.user.create({
      data: {
        id: userId,
        email: 'integration@canopy.local',
        name: 'Integration',
        passwordHash: 'test',
      },
    });
  });

  it('commits the snapshot, journal, and outbox atomically', async () => {
    const persistence = new PrismaOrderPersistence(prisma);
    const order = Order.create({ userId, totalCents: 4500 });
    await unitOfWork().persist(order, persistence);

    const [snapshot, journal, outbox] = await Promise.all([
      prisma.order.findUnique({ where: { id: order.id } }),
      prisma.domainEventJournal.findMany({ where: { aggregateId: order.id } }),
      prisma.frameworkOutbox.findMany({ where: { eventType: 'order.created' } }),
    ]);
    expect(snapshot?.version).toBe(1);
    expect(journal).toHaveLength(1);
    expect(outbox).toHaveLength(1);
  });

  it('rolls the snapshot back when in-transaction listener delivery fails', async () => {
    const persistence = new PrismaOrderPersistence(prisma);
    const order = Order.create({ userId, totalCents: 4500 });
    const events = {
      dispatchLocal: async () => {
        throw new Error('listener failed');
      },
    } as unknown as EventDispatcher;
    await expect(unitOfWork(events).persist(order, persistence)).rejects.toThrow('listener failed');
    await expect(prisma.order.count({ where: { id: order.id } })).resolves.toBe(0);
    await expect(
      prisma.domainEventJournal.count({ where: { aggregateId: order.id } }),
    ).resolves.toBe(0);
  });

  it('detects concurrent writes with optimistic versions', async () => {
    const persistence = new PrismaOrderPersistence(prisma);
    const unit = unitOfWork();
    const created = Order.create({ userId, totalCents: 4500 });
    await unit.persist(created, persistence);
    const first = await persistence.find(created.id);
    const second = await persistence.find(created.id);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    first!.update({ notes: 'first' });
    second!.update({ notes: 'second' });
    await unit.persist(first!, persistence);
    await expect(unit.persist(second!, persistence)).rejects.toBeInstanceOf(OptimisticLockError);
  });

  it('recovers expired leases with SKIP LOCKED claims', async () => {
    const persistence = new PrismaOrderPersistence(prisma);
    const outbox = new PrismaOutbox(prisma);
    const order = Order.create({ userId, totalCents: 4500 });
    await unitOfWork().persist(order, persistence);
    await prisma.frameworkOutbox.updateMany({
      where: { eventType: 'order.created' },
      data: { availableAt: new Date(Date.now() - 1_000) },
    });
    const first = await outbox.claim({ workerId: 'worker-one', limit: 10, leaseMs: 30_000 });
    expect(first).toHaveLength(1);
    await prisma.frameworkOutbox.update({
      where: { id: first[0]!.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
    });
    const recovered = await outbox.claim({ workerId: 'worker-two', limit: 10, leaseMs: 30_000 });
    expect(recovered.map(({ id }) => id)).toEqual([first[0]!.id]);
  });
});
