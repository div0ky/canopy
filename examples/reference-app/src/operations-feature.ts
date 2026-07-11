import { Feature } from '@canopy/core'

import { DatabaseConnection } from './database-connection.js'
import { FailCounter } from './fail-counter.js'
import { IncrementCounter } from './increment-counter.js'
import { NestedCounter } from './nested-counter.js'
import { MutateCounterQuery } from './mutate-counter-query.js'
import { ReadCounter } from './read-counter.js'
import { ReferenceTransactionManager } from './reference-transaction-manager.js'
import { Worker } from './worker.js'
import { WorkerConfig } from './worker-config.js'

export class OperationsFeature extends Feature {
  id = 'operations'
  configs = [WorkerConfig]
  providers = [DatabaseConnection, Worker, ReferenceTransactionManager]
  actions = [IncrementCounter, FailCounter, NestedCounter]
  queries = [ReadCounter, MutateCounterQuery]
}
