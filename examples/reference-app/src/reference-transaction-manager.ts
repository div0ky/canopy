import {
  TransactionManager,
  type ExecutionContext,
  type JournalFact,
  type JsonValue,
  type OutboxMessage,
  type PersistedEntity,
  type SaveEntity,
  type StagedDelivery,
  type DeliveryTransition,
  UnitOfWork,
} from '@doxajs/core'

import { operationLog } from './operation-log.js'

export class ReferenceTransactionManager extends TransactionManager {
  static id = 'transactions'

  async transaction<Output>(
    context: ExecutionContext,
    work: (unitOfWork: UnitOfWork) => Promise<Output>,
  ): Promise<Output> {
    operationLog.push(`transaction:begin:${context.executionId}`)
    const unitOfWork = new ReferenceUnitOfWork()
    try {
      const result = await work(unitOfWork)
      operationLog.push(`transaction:commit:${context.executionId}`)
      await unitOfWork.releaseAfterCommit()
      return result
    } catch (error) {
      operationLog.push(`transaction:rollback:${context.executionId}`)
      throw error
    }
  }
}

class ReferenceUnitOfWork extends UnitOfWork {
  readonly #afterCommit: Array<() => void | Promise<void>> = []

  findEntity<State extends JsonValue>(
    _type: string,
    _id: string,
  ): Promise<PersistedEntity<State> | undefined> {
    return Promise.resolve(undefined)
  }

  saveEntity<State extends JsonValue>(_entity: SaveEntity<State>): Promise<number> {
    return Promise.resolve(1)
  }

  deleteEntity(_type: string, _id: string, _expectedVersion: number): Promise<void> {
    return Promise.resolve()
  }

  record<Payload extends JsonValue>(_fact: JournalFact<Payload>): Promise<string> {
    return Promise.resolve('reference-journal')
  }

  enqueue<Payload extends JsonValue>(_message: OutboxMessage<Payload>): Promise<string> {
    return Promise.resolve('reference-outbox')
  }

  stageDelivery(_delivery: StagedDelivery): Promise<void> {
    return Promise.resolve()
  }
  transitionDelivery(_transition: DeliveryTransition): Promise<void> {
    return Promise.resolve()
  }

  afterCommit(callback: () => void | Promise<void>): void {
    this.#afterCommit.push(callback)
  }

  async releaseAfterCommit(): Promise<void> {
    for (const callback of this.#afterCommit) await callback()
    this.#afterCommit.length = 0
  }
}
