#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Command } from 'commander';
import { Prisma, prisma } from '@evergreen/db';
import { ExecutionContext } from '../context/execution-context.js';
import { BullJobDispatcher, BullScheduleSynchronizer } from '../adapters/bullmq.js';
import { PrismaOutbox } from '../adapters/prisma.js';
import { createRedis } from '../adapters/redis.js';
import { generate, type GeneratorKind, kebabCase } from './generators.js';

const program = new Command()
  .name('canopy')
  .description('Generate Canopy features and operate queues, outbox, schedules, and models')
  .version('0.1.0');

const generators: readonly GeneratorKind[] = [
  'model',
  'action',
  'query',
  'observer',
  'listener',
  'job',
  'schedule',
  'policy',
  'resource',
  'notification',
];

for (const kind of generators) {
  program
    .command(`make:${kind}`)
    .argument('<name>')
    .option('-r, --root <path>', 'feature package root', process.cwd())
    .action(async (name: string, options: { root: string }) => {
      const output = await generate(kind, name, resolve(options.root));
      console.log(`Created ${output}`);
    });
}

program
  .command('make:migration')
  .argument('<name>')
  .option('-r, --root <path>', 'workspace root', process.cwd())
  .action(async (name: string, options: { root: string }) => {
    const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    const directory = join(
      resolve(options.root),
      'packages/db/prisma/migrations',
      `${timestamp}_${kebabCase(name)}`,
    );
    await mkdir(directory, { recursive: true });
    const output = join(directory, 'migration.sql');
    await writeFile(output, `-- ${name}\n`, { flag: 'wx' });
    console.log(`Created ${output}`);
  });

function redisUrl(): string {
  return process.env['REDIS_URL'] ?? 'redis://localhost:6379';
}

program.command('queue:failed').action(async () => {
  const redis = createRedis(redisUrl());
  const jobs = new BullJobDispatcher(redis);
  try {
    for (const queueName of ['events', 'limited', 'cron'] as const) {
      const failed = await jobs.queue(queueName).getJobs(['failed'], 0, 99);
      for (const job of failed)
        console.log(`${queueName}\t${job.id ?? '-'}\t${job.name}\t${job.failedReason}`);
    }
  } finally {
    await jobs.onModuleDestroy();
    await redis.quit();
  }
});

program
  .command('queue:retry')
  .argument('<id>')
  .action(async (id: string) => {
    const redis = createRedis(redisUrl());
    const jobs = new BullJobDispatcher(redis);
    try {
      const retried = await jobs.retryFailed(id);
      console.log(`Retried ${retried.queue}:${retried.id}`);
    } finally {
      await jobs.onModuleDestroy();
      await redis.quit();
    }
  });

program
  .command('outbox:list')
  .option('-s, --status <status>')
  .action(async (options: { status?: 'pending' | 'processing' | 'published' | 'dead' }) => {
    const outbox = new PrismaOutbox(prisma);
    for (const message of await outbox.list(options.status)) {
      console.log(
        `${message.id}\t${message.eventType}@${message.eventVersion}\t${message.attempts}`,
      );
    }
  });

program
  .command('outbox:retry')
  .argument('<id>')
  .action(async (id: string) => {
    await new PrismaOutbox(prisma).retry(id);
    console.log(`Queued outbox message ${id} for replay`);
  });

program.command('schedule:list').action(async () => {
  const redis = createRedis(redisUrl());
  const jobs = new BullJobDispatcher(redis, new ExecutionContext());
  try {
    for (const schedule of await new BullScheduleSynchronizer(jobs).list()) {
      console.log(
        `${schedule.id}\t${schedule.pattern}\t${schedule.timezone}\t${schedule.nextRunAt?.toISOString() ?? '-'}`,
      );
    }
  } finally {
    await jobs.onModuleDestroy();
    await redis.quit();
  }
});

program
  .command('model:show')
  .argument('<name>')
  .action((name: string) => {
    const model = Prisma.dmmf.datamodel.models.find(
      (candidate) => candidate.name.toLowerCase() === name.toLowerCase(),
    );
    if (!model) throw new Error(`Model ${name} was not found`);
    for (const field of model.fields)
      console.log(`${field.name}\t${field.type}${field.isRequired ? '' : '?'}`);
  });

await program.parseAsync();
await prisma.$disconnect();
