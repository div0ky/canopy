import type { BroadcastMessage, Broadcaster } from '@evergreen/canopy';
import {
  AblyBroadcaster,
  BasicTracer,
  BullJobDispatcher,
  BullScheduleSynchronizer,
  CompositeBroadcaster,
  DiskStorage,
  LocalStorageDisk,
  LoggingErrorReporter,
  PinoLogger,
  PrismaEventJournal,
  PrismaOutbox,
  PrismaTransactionManager,
  ProductionNotificationSender,
  RedisCache,
  RedisBroadcaster,
  RedisBroadcastSubscriber,
  createRedis,
} from '@evergreen/canopy/adapters';
import { prisma } from '@evergreen/db';
import type { Server } from 'socket.io';

export class RuntimeSocketBroadcaster implements Broadcaster {
  #server?: Server;

  public connect(server: Server): void {
    this.#server = server;
  }

  public async broadcast<TPayload>(message: BroadcastMessage<TPayload>): Promise<void> {
    this.#server?.to(message.channel).emit(message.event, message.payload);
  }
}

export const redis: ReturnType<typeof createRedis> = createRedis(
  process.env['REDIS_URL'] ?? 'redis://localhost:6379',
);
export const logger = new PinoLogger({ level: process.env['LOG_LEVEL'] ?? 'info' });
export const socketBroadcaster = new RuntimeSocketBroadcaster();
const broadcasters: Broadcaster[] = [new RedisBroadcaster(redis)];
if (process.env['ABLY_API_KEY'])
  broadcasters.push(new AblyBroadcaster(process.env['ABLY_API_KEY']));
export const broadcaster = new CompositeBroadcaster(broadcasters);
export const broadcastSubscriber = new RedisBroadcastSubscriber(
  redis.duplicate(),
  socketBroadcaster,
);
void broadcastSubscriber.start();
export const jobs = new BullJobDispatcher(redis);
export const outbox = new PrismaOutbox(prisma);

export const canopyOptions = {
  transactions: new PrismaTransactionManager(prisma),
  journal: new PrismaEventJournal(),
  outbox,
  jobs,
  cache: new RedisCache(redis),
  storage: new DiskStorage({
    local: new LocalStorageDisk(process.env['STORAGE_LOCAL_ROOT'] ?? '.canopy/storage'),
  }),
  notifications: new ProductionNotificationSender({
    database: prisma,
    broadcaster,
    ...(process.env['TWILIO_ACCOUNT_SID'] &&
    process.env['TWILIO_AUTH_TOKEN'] &&
    process.env['TWILIO_FROM']
      ? {
          twilio: {
            accountSid: process.env['TWILIO_ACCOUNT_SID'],
            authToken: process.env['TWILIO_AUTH_TOKEN'],
            from: process.env['TWILIO_FROM'],
          },
        }
      : {}),
    ...(process.env['SENDGRID_API_KEY'] && process.env['SENDGRID_FROM']
      ? {
          sendgrid: { apiKey: process.env['SENDGRID_API_KEY'], from: process.env['SENDGRID_FROM'] },
        }
      : {}),
  }),
  broadcaster,
  logger,
  reporter: new LoggingErrorReporter(logger),
  tracer: new BasicTracer(logger),
  auth: {
    jwtSecret: process.env['JWT_SECRET'] ?? 'local-development-jwt-secret-change-me',
    serviceTokenSecret:
      process.env['SERVICE_TOKEN_SECRET'] ?? 'local-development-service-secret-change-me',
  },
  schedules: new BullScheduleSynchronizer(jobs),
} as const;
