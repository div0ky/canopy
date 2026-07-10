import {
  Global,
  Inject,
  Injectable,
  Module,
  type ModuleMetadata,
  type OnModuleInit,
  type Provider,
  type DynamicModule,
  type InjectionToken,
} from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { Authentication, type AuthOptions } from './auth/auth.js';
import { Authorization } from './auth/authorization.js';
import {
  Broadcasting,
  CacheManager,
  Log,
  Notifications,
  Report,
  StorageManager,
  Tracing,
} from './batteries.js';
import type { Broadcaster } from './broadcasting/broadcasting.js';
import type { Cache } from './cache/cache.js';
import { ExecutionContext } from './context/execution-context.js';
import { ActionBus, QueryBus } from './cqrs/cqrs.js';
import { ConfigurationError } from './errors.js';
import { EventDispatcher } from './events/event-dispatcher.js';
import './events/publish-event-job.handler.js';
import type { JobDispatch } from './jobs/jobs.js';
import { Jobs } from './jobs/jobs.js';
import { ObserverRegistry } from './models/observers.js';
import type { NotificationSender } from './notifications/notifications.js';
import type { ErrorReporter, Logger, Tracer } from './observability/observability.js';
import type { EventJournal, Outbox, TransactionManager } from './persistence/ports.js';
import { UnitOfWork } from './persistence/unit-of-work.js';
import { FrameworkRegistry, type Constructor } from './registry/framework-registry.js';
import type { ScheduleSynchronizer } from './scheduling/schedules.js';
import type { Storage } from './storage/storage.js';
import { CanopyAuthGuard, CanopyContextInterceptor } from './http/nest.js';
import {
  CANOPY_BROADCASTER,
  CANOPY_CACHE,
  CANOPY_JOB_DISPATCHER,
  CANOPY_JOURNAL,
  CANOPY_LOGGER,
  CANOPY_NOTIFICATIONS,
  CANOPY_OPTIONS,
  CANOPY_OUTBOX,
  CANOPY_REPORTER,
  CANOPY_STORAGE,
  CANOPY_TRANSACTION_MANAGER,
  CANOPY_TRACER,
} from './tokens.js';

export interface CanopyOptions {
  readonly transactions: TransactionManager;
  readonly journal: EventJournal;
  readonly outbox: Outbox;
  readonly jobs: JobDispatch;
  readonly cache: Cache;
  readonly storage: Storage;
  readonly notifications: NotificationSender;
  readonly broadcaster: Broadcaster;
  readonly logger: Logger;
  readonly reporter: ErrorReporter;
  readonly tracer: Tracer;
  readonly auth: AuthOptions;
  readonly schedules?: ScheduleSynchronizer;
  readonly actions?: readonly Constructor[];
  readonly queries?: readonly Constructor[];
  readonly outboxDefaults?: {
    readonly batchSize?: number;
    readonly leaseMs?: number;
    readonly maxAttempts?: number;
    readonly baseDelayMs?: number;
  };
}

export interface CanopyAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  readonly inject?: readonly InjectionToken[];
  readonly useFactory: (...dependencies: never[]) => CanopyOptions | Promise<CanopyOptions>;
}

@Injectable()
class CanopyBootstrap implements OnModuleInit {
  public constructor(@Inject(CANOPY_OPTIONS) private readonly options: CanopyOptions) {}

  public async onModuleInit(): Promise<void> {
    FrameworkRegistry.assertHandled('action', this.options.actions ?? []);
    FrameworkRegistry.assertHandled('query', this.options.queries ?? []);
    await this.options.schedules?.synchronize();
  }
}

const optionDriver = (token: symbol, key: keyof CanopyOptions): Provider => ({
  provide: token,
  inject: [CANOPY_OPTIONS],
  useFactory: (options: CanopyOptions): unknown => {
    const value = options[key];
    if (value === undefined) throw new ConfigurationError(`Canopy option ${key} is required`);
    return value;
  },
});

@Global()
@Module({})
export class CanopyModule {
  public static forRootAsync(options: CanopyAsyncOptions): DynamicModule {
    const optionsProvider: Provider = {
      provide: CANOPY_OPTIONS,
      inject: [...(options.inject ?? [])],
      useFactory: options.useFactory,
    };
    const drivers: Provider[] = [
      optionDriver(CANOPY_TRANSACTION_MANAGER, 'transactions'),
      optionDriver(CANOPY_JOURNAL, 'journal'),
      optionDriver(CANOPY_OUTBOX, 'outbox'),
      optionDriver(CANOPY_JOB_DISPATCHER, 'jobs'),
      optionDriver(CANOPY_CACHE, 'cache'),
      optionDriver(CANOPY_STORAGE, 'storage'),
      optionDriver(CANOPY_NOTIFICATIONS, 'notifications'),
      optionDriver(CANOPY_BROADCASTER, 'broadcaster'),
      optionDriver(CANOPY_LOGGER, 'logger'),
      optionDriver(CANOPY_REPORTER, 'reporter'),
      optionDriver(CANOPY_TRACER, 'tracer'),
    ];
    const core: Provider[] = [
      ExecutionContext,
      ActionBus,
      QueryBus,
      ObserverRegistry,
      EventDispatcher,
      UnitOfWork,
      Jobs,
      CacheManager,
      StorageManager,
      Notifications,
      Broadcasting,
      Log,
      Report,
      Tracing,
      Authorization,
      CanopyBootstrap,
      CanopyAuthGuard,
      CanopyContextInterceptor,
      {
        provide: Authentication,
        inject: [CANOPY_OPTIONS],
        useFactory: (configured: CanopyOptions): Authentication =>
          new Authentication(configured.auth),
      },
    ];
    const providers = [optionsProvider, ...drivers, ...core, ...FrameworkRegistry.providerTypes()];
    return {
      module: CanopyModule,
      imports: [...(options.imports ?? []), CqrsModule.forRoot()],
      providers,
      exports: [
        CANOPY_TRANSACTION_MANAGER,
        CANOPY_JOURNAL,
        CANOPY_OUTBOX,
        CANOPY_JOB_DISPATCHER,
        CANOPY_CACHE,
        CANOPY_STORAGE,
        CANOPY_NOTIFICATIONS,
        CANOPY_BROADCASTER,
        CANOPY_LOGGER,
        CANOPY_REPORTER,
        CANOPY_TRACER,
        ExecutionContext,
        ActionBus,
        QueryBus,
        ObserverRegistry,
        EventDispatcher,
        UnitOfWork,
        Jobs,
        CacheManager,
        StorageManager,
        Notifications,
        Broadcasting,
        Log,
        Report,
        Tracing,
        Authorization,
        Authentication,
        CanopyAuthGuard,
        CanopyContextInterceptor,
      ],
    };
  }
}
