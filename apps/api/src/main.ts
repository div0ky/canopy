import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { broadcastSubscriber, jobs, redis } from './runtime.js';

const app = await NestFactory.create(AppModule, { bufferLogs: true });
app.enableShutdownHooks();
app.enableCors({ origin: false });
await app.listen(Number(process.env['PORT'] ?? 3000));

const shutdown = async (): Promise<void> => {
  await app.close();
  await jobs.onModuleDestroy();
  await broadcastSubscriber.close();
  await redis.quit();
};

process.once('SIGINT', () => {
  void shutdown();
});
process.once('SIGTERM', () => {
  void shutdown();
});
