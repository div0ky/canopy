import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineEvent } from '../events/events.js';
import { DomainModel, type ModelSnapshot } from './domain-model.js';

interface Attributes extends Record<string, unknown> {
  name: string;
  count: number;
}

const Changed = defineEvent('test.changed', 1, z.object({ name: z.string() }));

class TestModel extends DomainModel<string, Attributes> {
  public constructor(snapshot: ModelSnapshot<string, Attributes>, persisted = true) {
    super(snapshot, persisted);
  }
  public rename(name: string): void {
    this.set({ name });
    this.record(
      Changed.create({
        aggregateType: 'TestModel',
        aggregateId: this.id,
        aggregateVersion: this.version + 1,
        payload: { name },
      }),
    );
  }
}

describe('DomainModel', () => {
  it('tracks originals, dirty attributes, versions, events, and explicit snapshots', () => {
    const model = new TestModel({
      id: 'one',
      attributes: { name: 'before', count: 1 },
      version: 3,
    });
    model.rename('after');

    expect(model.original).toEqual({ name: 'before', count: 1 });
    expect(model.attributes).toEqual({ name: 'after', count: 1 });
    expect(model.dirty).toEqual({ name: 'after' });
    expect(model.isDirty('name')).toBe(true);
    expect(model.events()).toHaveLength(1);
    expect(model.serialize()).toEqual({
      id: 'one',
      attributes: { name: 'after', count: 1 },
      version: 3,
    });

    model.markPersisted(4);
    expect(model.version).toBe(4);
    expect(model.dirty).toEqual({});
    expect(model.events()).toEqual([]);
  });
});
