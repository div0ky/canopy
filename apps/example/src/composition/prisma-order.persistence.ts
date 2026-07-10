import { OptimisticLockError, type Cursor } from '@evergreen/canopy';
import { prisma, type DatabaseClient, type Prisma } from '@evergreen/db';
import { Order } from '../orders/order.model.js';
import type { OrderPersistence } from '../orders/order.persistence.js';

type Transaction = Prisma.TransactionClient;
type Client = DatabaseClient | Transaction;

export class PrismaOrderPersistence implements OrderPersistence {
  public constructor(private readonly database: DatabaseClient = prisma) {}

  public async find(id: string, transaction?: unknown): Promise<Order | null> {
    const row = await this.client(transaction).order.findFirst({ where: { id, deletedAt: null } });
    return row ? this.hydrate(row) : null;
  }

  public async create(order: Order, transaction: unknown): Promise<number> {
    const attributes = order.attributes;
    const row = await this.client(transaction).order.create({
      data: {
        id: order.id,
        userId: attributes.userId,
        number: attributes.number,
        status: attributes.status,
        totalCents: attributes.totalCents,
        notes: attributes.notes,
        version: 1,
        createdAt: attributes.createdAt,
        updatedAt: attributes.updatedAt,
      },
    });
    return row.version;
  }

  public async update(
    order: Order,
    expectedVersion: number,
    transaction: unknown,
  ): Promise<number> {
    const attributes = order.attributes;
    const result = await this.client(transaction).order.updateMany({
      where: { id: order.id, version: expectedVersion, deletedAt: null },
      data: {
        status: attributes.status,
        totalCents: attributes.totalCents,
        notes: attributes.notes,
        updatedAt: attributes.updatedAt,
        version: { increment: 1 },
      },
    });
    if (result.count !== 1) throw new OptimisticLockError('Order', order.id, expectedVersion);
    return expectedVersion + 1;
  }

  public async delete(
    order: Order,
    expectedVersion: number,
    transaction: unknown,
  ): Promise<number> {
    const result = await this.client(transaction).order.updateMany({
      where: { id: order.id, version: expectedVersion, deletedAt: null },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });
    if (result.count !== 1) throw new OptimisticLockError('Order', order.id, expectedVersion);
    return expectedVersion + 1;
  }

  public async restore(
    order: Order,
    expectedVersion: number,
    transaction: unknown,
  ): Promise<number> {
    const result = await this.client(transaction).order.updateMany({
      where: { id: order.id, version: expectedVersion, deletedAt: { not: null } },
      data: { deletedAt: null, version: { increment: 1 } },
    });
    if (result.count !== 1) throw new OptimisticLockError('Order', order.id, expectedVersion);
    return expectedVersion + 1;
  }

  public async list(input: {
    userId: string;
    cursor?: Cursor;
    limit: number;
  }): Promise<readonly Order[]> {
    const rows = await this.database.order.findMany({
      where: {
        userId: input.userId,
        deletedAt: null,
        ...(input.cursor
          ? {
              OR: [
                { createdAt: { lt: input.cursor.createdAt } },
                { createdAt: input.cursor.createdAt, id: { lt: input.cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.limit,
    });
    return rows.map((row) => this.hydrate(row));
  }

  public async stale(olderThan: Date, limit: number): Promise<readonly Order[]> {
    const rows = await this.database.order.findMany({
      where: {
        status: { in: ['draft', 'submitted'] },
        updatedAt: { lt: olderThan },
        deletedAt: null,
      },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });
    return rows.map((row) => this.hydrate(row));
  }

  public async attach(input: {
    orderId: string;
    disk: string;
    path: string;
    contentType: string;
    size: number;
  }): Promise<void> {
    await this.database.orderAttachment.create({
      data: {
        orderId: input.orderId,
        disk: input.disk,
        path: input.path,
        mimeType: input.contentType,
        size: input.size,
      },
    });
  }

  private client(transaction?: unknown): Client {
    return transaction ? (transaction as Transaction) : this.database;
  }

  private hydrate(row: {
    id: string;
    userId: string;
    number: string;
    status: 'draft' | 'submitted' | 'paid' | 'cancelled';
    totalCents: number;
    notes: string | null;
    version: number;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  }): Order {
    return Order.hydrate({
      id: row.id,
      version: row.version,
      attributes: {
        userId: row.userId,
        number: row.number,
        status: row.status,
        totalCents: row.totalCents,
        notes: row.notes,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
      deleted: row.deletedAt !== null,
    });
  }
}
