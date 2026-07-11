CREATE TABLE IF NOT EXISTS doxa_entity_states (
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS doxa_journal_entries (
  id uuid PRIMARY KEY,
  fact_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  payload jsonb NOT NULL,
  context jsonb NOT NULL,
  occurred_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS doxa_journal_entity_idx
  ON doxa_journal_entries (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS doxa_journal_context_idx
  ON doxa_journal_entries USING gin (context);

CREATE TABLE IF NOT EXISTS doxa_outbox_messages (
  id uuid PRIMARY KEY,
  message_type text NOT NULL,
  payload jsonb NOT NULL,
  context jsonb NOT NULL,
  status text NOT NULL,
  available_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS doxa_outbox_available_idx
  ON doxa_outbox_messages (status, available_at);
