CREATE TABLE IF NOT EXISTS doxa_delivery_messages (
  id uuid PRIMARY KEY,
  channel text NOT NULL CHECK (channel IN ('mail', 'sms')),
  recipients jsonb NOT NULL,
  payload jsonb NOT NULL,
  state text NOT NULL,
  provider_message_id text,
  failure_kind text,
  failure_code text,
  context jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS doxa_delivery_state_idx ON doxa_delivery_messages (channel, state);

CREATE TABLE IF NOT EXISTS doxa_delivery_events (
  event_id text PRIMARY KEY,
  message_id uuid NOT NULL REFERENCES doxa_delivery_messages(id) ON DELETE CASCADE,
  state text NOT NULL,
  occurred_at timestamptz NOT NULL
);
