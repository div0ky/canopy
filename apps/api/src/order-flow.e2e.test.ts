import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Socket } from 'socket.io-client';
import type { DatabaseClient } from '@evergreen/db';

const integration = process.env['RUN_INTEGRATION'] === '1';
const userId = '00000000-0000-4000-8000-000000000001';

describe.skipIf(!integration)('reference Order domain', () => {
  let api: INestApplication;
  let worker: INestApplicationContext;
  let baseUrl: string;
  let token: string;
  let prisma: DatabaseClient;

  beforeAll(async () => {
    ({ prisma } = await import('@evergreen/db'));
    await prisma.$executeRawUnsafe(
      'TRUNCATE notifications, order_attachments, framework_failed_jobs, framework_outbox, domain_event_journal, orders, users CASCADE',
    );
    await prisma.user.create({
      data: { id: userId, email: 'e2e@canopy.local', name: 'E2E', passwordHash: 'test' },
    });

    const { AppModule } = await import('./app.module.js');
    api = await NestFactory.create(AppModule, { logger: false });
    await api.listen(0, '127.0.0.1');
    baseUrl = await api.getUrl();

    const tokenResponse = await request(api.getHttpServer())
      .post('/auth/token')
      .send({ userId })
      .expect(201);
    token = tokenResponse.body.data.token as string;

    const { WorkerModule } = await import('@canopy/worker/module');
    worker = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
  });

  afterAll(async () => {
    await worker?.close();
    await api?.close();
    const apiRuntime = await import('./runtime.js');
    await apiRuntime.jobs.onModuleDestroy();
    await apiRuntime.broadcastSubscriber.close();
    await apiRuntime.redis.quit();
    const workerRuntime = await import('@canopy/worker/runtime');
    await workerRuntime.closeWorkerResources();
    await prisma?.$disconnect();
  });

  it('executes request → model → journal/outbox → worker → notification/broadcast', async () => {
    const { io } = await import('socket.io-client');
    const socket: Socket = io(`${baseUrl}/orders`, {
      transports: ['websocket'],
      auth: { token },
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });

    const broadcast = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('order.created broadcast timed out')),
        10_000,
      );
      socket.once('order.created', (payload: Record<string, unknown>) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

    const created = await request(api.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ totalCents: 5500, notes: 'end to end' })
      .expect(201);
    const orderId = created.body.data.id as string;
    expect(created.body.data.version).toBe(1);

    await expect(broadcast).resolves.toMatchObject({ orderId, userId });
    await expect(
      request(api.getHttpServer())
        .get('/orders')
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
    ).resolves.toMatchObject({ body: { data: [{ id: orderId }] } });

    await expect(
      prisma.domainEventJournal.count({ where: { aggregateId: orderId } }),
    ).resolves.toBe(1);
    await expect(
      prisma.frameworkOutbox.count({ where: { eventType: 'order.created', status: 'published' } }),
    ).resolves.toBe(1);
    await expect(prisma.notification.count({ where: { userId } })).resolves.toBe(1);
    socket.close();
  });
});
