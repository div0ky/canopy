import type { JsonValue } from '@doxajs/core'
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

export interface DurableExecutionEnvelope {
  readonly executionId: string
  readonly correlationId: string
  readonly causationId?: string
  readonly actor: { readonly kind: string; readonly id?: string }
  readonly initiator: { readonly kind: string; readonly id?: string }
  readonly tenant?: { readonly id: string }
  readonly delegation?: readonly {
    readonly from: { readonly kind: string; readonly id?: string }
    readonly to: { readonly kind: string; readonly id?: string }
    readonly grantId: string
    readonly reason: string
    readonly expiresAt?: string
  }[]
  readonly authentication?: {
    readonly state: 'anonymous' | 'authenticated'
    readonly identityId?: string
    readonly method?: string
    readonly assurance?: string
    readonly authenticatedAt?: string
    readonly credentialId?: string
    readonly constraints?: readonly string[]
  }
  readonly trace?: {
    readonly traceId?: string
    readonly spanId?: string
    readonly traceFlags?: number
  }
}

export const entityStates = pgTable(
  'doxa_entity_states',
  {
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    version: integer('version').notNull(),
    state: jsonb('state').$type<JsonValue>().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.entityType, table.entityId] })],
)

export const journalEntries = pgTable(
  'doxa_journal_entries',
  {
    id: uuid('id').primaryKey(),
    factType: text('fact_type').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    payload: jsonb('payload').$type<JsonValue>().notNull(),
    context: jsonb('context').$type<DurableExecutionEnvelope>().notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [
    index('doxa_journal_entity_idx').on(table.entityType, table.entityId),
    index('doxa_journal_context_idx').using('gin', table.context),
  ],
)

export const outboxMessages = pgTable(
  'doxa_outbox_messages',
  {
    id: uuid('id').primaryKey(),
    messageType: text('message_type').notNull(),
    payload: jsonb('payload').$type<JsonValue>().notNull(),
    context: jsonb('context').$type<DurableExecutionEnvelope>().notNull(),
    status: text('status').notNull(),
    availableAt: timestamp('available_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [index('doxa_outbox_available_idx').on(table.status, table.availableAt)],
)

export const deliveryMessages = pgTable(
  'doxa_delivery_messages',
  {
    id: uuid('id').primaryKey(),
    channel: text('channel').notNull(),
    recipients: jsonb('recipients').$type<readonly string[]>().notNull(),
    payload: jsonb('payload').$type<JsonValue>().notNull(),
    state: text('state').notNull(),
    providerMessageId: text('provider_message_id'),
    failureKind: text('failure_kind'),
    failureCode: text('failure_code'),
    context: jsonb('context').$type<DurableExecutionEnvelope>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [index('doxa_delivery_state_idx').on(table.channel, table.state)],
)

export const deliveryEvents = pgTable('doxa_delivery_events', {
  eventId: text('event_id').primaryKey(),
  messageId: uuid('message_id').notNull(),
  state: text('state').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
})

export const persistenceSchema = {
  entityStates,
  journalEntries,
  outboxMessages,
  deliveryMessages,
  deliveryEvents,
}
