import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ExecutionContext } from '../context/execution-context.js';
import type { EventDispatcher } from '../events/event-dispatcher.js';
import { defineEvent } from '../events/events.js';
import { DomainModel, type ModelSnapshot } from '../models/domain-model.js';
import type { ObserverRegistry } from '../models/observers.js';
import { FakeEventJournal, FakeOutbox, FakeTransactionManager } from '../testing/fakes.js';
import type { ModelPersistenceAdapter } from './ports.js';
import { UnitOfWork } from './unit-of-work.js';

interface Attributes extends Record<string, unknown> {
  value: string;
}
const Created = defineEvent('test.created', 1, z.object({ value: z.string() }));

class TestModel extends DomainModel<string, Attributes> {
  public constructor(snapshot: ModelSnapshot<string, Attributes>, persisted = false) {
    super(snapshot, persisted);
  }
  public emit(): void {
    this.record(
      Created.create({
        aggregateType: 'Test',
        aggregateId: this.id,
        aggregateVersion: 1,
        payload: { value: 'x' },
      }),
    );
  }
}

describe('UnitOfWork', () => {
  it('orders lifecycle callbacks and atomically stages snapshot, journal, and outbox', async () => {
    const lifecycle: string[] = [];
    const observer = {
      dispatch: async (_model: TestModel, name: string) => {
        lifecycle.push(name);
      },
    } as unknown as ObserverRegistry;
    const localEvents: string[] = [];
    const dispatcher = {
      dispatchLocal: async (events: Array<{ type: string }>) => {
        localEvents.push(...events.map(({ type }) => type));
      },
    } as unknown as EventDispatcher;
    const journal = new FakeEventJournal();
    const outbox = new FakeOutbox();
    const writes: string[] = [];
    const adapter: ModelPersistenceAdapter<TestModel, string, Attributes> = {
      find: async () => null,
      create: async () => {
        writes.push('create');
        return 1;
      },
      update: async () => 2,
      delete: async () => 2,
      restore: async () => 2,
    };
    const unit = new UnitOfWork(
      new FakeTransactionManager(),
      journal,
      outbox,
      new ExecutionContext(),
      observer,
      dispatcher,
    );
    const model = new TestModel({ id: 'model-1', attributes: { value: 'x' }, version: 0 });
    model.emit();

    await unit.persist(model, adapter);

    expect(writes).toEqual(['create']);
    expect(lifecycle).toEqual(['creating', 'saving', 'created', 'saved', 'committed']);
    expect(localEvents).toEqual(['test.created']);
    expect(journal.events).toHaveLength(1);
    expect(outbox.messages).toHaveLength(1);
    expect(model.version).toBe(1);
    expect(model.exists).toBe(true);
  });
});
