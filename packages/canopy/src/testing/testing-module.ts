import { Module, type DynamicModule } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { ActionBus, QueryBus } from '../cqrs/cqrs.js';
import { ExecutionContext } from '../context/execution-context.js';
import { Jobs } from '../jobs/jobs.js';
import { EventDispatcher } from '../events/event-dispatcher.js';
import '../events/publish-event-job.handler.js';
import { ObserverRegistry } from '../models/observers.js';
import { UnitOfWork } from '../persistence/unit-of-work.js';
import { FrameworkRegistry } from '../registry/framework-registry.js';
import {
  CANOPY_BROADCASTER,
  CANOPY_CACHE,
  CANOPY_JOB_DISPATCHER,
  CANOPY_JOURNAL,
  CANOPY_LOGGER,
  CANOPY_NOTIFICATIONS,
  CANOPY_OUTBOX,
  CANOPY_REPORTER,
  CANOPY_STORAGE,
  CANOPY_TRANSACTION_MANAGER,
  CANOPY_TRACER,
} from '../tokens.js';
import {
  FakeBroadcaster,
  FakeErrorReporter,
  FakeEventJournal,
  FakeJobDispatcher,
  FakeLogger,
  FakeNotificationSender,
  FakeOutbox,
  FakeStorage,
  FakeTransactionManager,
  FakeTracer,
  InMemoryCache,
} from './fakes.js';

@Module({})
export class CanopyTestingModule {
  public static create(): DynamicModule {
    const providers = [
      ExecutionContext,
      ActionBus,
      QueryBus,
      ObserverRegistry,
      EventDispatcher,
      UnitOfWork,
      Jobs,
      ...FrameworkRegistry.providerTypes(),
      { provide: CANOPY_TRANSACTION_MANAGER, useClass: FakeTransactionManager },
      { provide: CANOPY_JOURNAL, useClass: FakeEventJournal },
      { provide: CANOPY_OUTBOX, useClass: FakeOutbox },
      { provide: CANOPY_JOB_DISPATCHER, useClass: FakeJobDispatcher },
      { provide: CANOPY_CACHE, useClass: InMemoryCache },
      { provide: CANOPY_STORAGE, useClass: FakeStorage },
      { provide: CANOPY_NOTIFICATIONS, useClass: FakeNotificationSender },
      { provide: CANOPY_BROADCASTER, useClass: FakeBroadcaster },
      { provide: CANOPY_LOGGER, useClass: FakeLogger },
      { provide: CANOPY_REPORTER, useClass: FakeErrorReporter },
      { provide: CANOPY_TRACER, useClass: FakeTracer },
    ];
    return {
      module: CanopyTestingModule,
      imports: [CqrsModule.forRoot()],
      providers,
      exports: providers,
    };
  }
}
