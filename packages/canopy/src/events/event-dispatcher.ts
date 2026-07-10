import { Inject, Injectable, type OnModuleInit, type Type } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { DomainEvent, HandlesEvent } from './events.js';
import { FrameworkRegistry } from '../registry/framework-registry.js';

interface RegisteredListener {
  readonly queued: boolean;
  readonly instance: HandlesEvent<unknown>;
}

@Injectable()
export class EventDispatcher implements OnModuleInit {
  readonly #listeners = new Map<string, RegisteredListener[]>();

  public constructor(@Inject(ModuleRef) private readonly moduleRef: ModuleRef) {}

  public async onModuleInit(): Promise<void> {
    for (const { event, listener, queued } of FrameworkRegistry.listeners()) {
      const instance = this.moduleRef.get(listener as unknown as Type<HandlesEvent<unknown>>, {
        strict: false,
      });
      const listeners = this.#listeners.get(event) ?? [];
      listeners.push({ queued, instance });
      this.#listeners.set(event, listeners);
    }
  }

  public dispatchLocal(events: readonly DomainEvent[]): Promise<void> {
    return this.dispatch(events, false);
  }

  public dispatchQueued(events: readonly DomainEvent[]): Promise<void> {
    return this.dispatch(events, true);
  }

  private async dispatch(events: readonly DomainEvent[], queued: boolean): Promise<void> {
    for (const event of events) {
      for (const listener of this.#listeners.get(event.type) ?? []) {
        if (listener.queued === queued) await listener.instance.handle(event);
      }
    }
  }
}
