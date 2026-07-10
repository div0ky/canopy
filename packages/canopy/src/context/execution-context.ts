import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';

export interface Actor {
  readonly id: string;
  readonly type: 'user' | 'service';
  readonly roles?: readonly string[];
  readonly abilities?: readonly string[];
}

export interface ExecutionContextState<TTransaction = unknown> {
  readonly actor?: Actor;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly locale: string;
  readonly traceId: string;
  readonly transaction?: TTransaction;
  readonly afterCommit: Array<() => void | Promise<void>>;
}

export type ExecutionContextInput<TTransaction = unknown> = Partial<
  Omit<ExecutionContextState<TTransaction>, 'afterCommit'>
>;

@Injectable()
export class ExecutionContext {
  readonly #storage = new AsyncLocalStorage<ExecutionContextState>();

  public get active(): boolean {
    return this.#storage.getStore() !== undefined;
  }

  public current(): ExecutionContextState {
    const state = this.#storage.getStore();
    if (!state) {
      throw new Error('No Canopy execution context is active');
    }
    return state;
  }

  public optional(): ExecutionContextState | undefined {
    return this.#storage.getStore();
  }

  public async run<TResult>(
    input: ExecutionContextInput,
    operation: () => TResult | Promise<TResult>,
  ): Promise<TResult> {
    const parent = this.#storage.getStore();
    const actor = input.actor ?? parent?.actor;
    const causationId = input.causationId ?? parent?.causationId;
    const state: ExecutionContextState = {
      correlationId: input.correlationId ?? parent?.correlationId ?? randomUUID(),
      locale: input.locale ?? parent?.locale ?? 'en',
      traceId: input.traceId ?? parent?.traceId ?? randomUUID(),
      afterCommit: [],
      ...(actor ? { actor } : {}),
      ...(causationId ? { causationId } : {}),
      ...(input.transaction !== undefined ? { transaction: input.transaction } : {}),
    };
    return this.#storage.run(state, operation);
  }

  public async withTransaction<TResult>(
    transaction: unknown,
    operation: () => TResult | Promise<TResult>,
  ): Promise<TResult> {
    const parent = this.current();
    return this.#storage.run({ ...parent, transaction }, operation);
  }

  public afterCommit(operation: () => void | Promise<void>): void {
    this.current().afterCommit.push(operation);
  }

  public async flushAfterCommit(): Promise<void> {
    const operations = this.current().afterCommit.splice(0);
    for (const operation of operations) {
      await operation();
    }
  }
}
