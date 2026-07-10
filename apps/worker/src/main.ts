import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './app.module.js';
import { closeWorkerResources } from './worker.services.js';

const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
app.enableShutdownHooks();

const shutdown = async (): Promise<void> => {
  await app.close();
  await closeWorkerResources();
};

process.once('SIGINT', () => {
  void shutdown();
});
process.once('SIGTERM', () => {
  void shutdown();
});
