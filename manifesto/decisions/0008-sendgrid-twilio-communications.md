# 0008: Provide SendGrid Email and Twilio SMS Plugins in the MVP

- **Status:** Accepted
- **Accepted:** 2026-07-10
- **Decision owners:** Doxa maintainers

## Decision

Doxa will own first-party mail and SMS contracts. The MVP will ship a SendGrid email plugin and a
Twilio Programmable Messaging SMS plugin.

Applications will compose Doxa-owned messages, templates, addresses, delivery options, and
assertions. Provider SDKs remain private implementation engines inside their plugins.

## Delivery model

Email and SMS delivery must flow through the transactional outbox and Doxa jobs. A provider API
response records provider acceptance, not final delivery.

The communications contract will normalize at least:

- `pending`
- `accepted`
- `sent`
- `delivered`
- `undelivered`
- `failed`
- `suppressed`
- `cancelled`

The exact valid transitions may differ by channel, but feature code observes Doxa states and stable
failure codes rather than vendor strings.

Provider message IDs must correlate back to the Doxa message, job, actor, initiator, tenant,
causation, correlation, and trace context. Webhook ingestion verifies provider signatures before
updating delivery state or emitting Doxa events.

## SendGrid plugin

The SendGrid plugin will:

- Use the SendGrid v3 Mail Send API.
- Treat HTTP `202 Accepted` as queued by SendGrid, not delivered.
- Support verified senders, content, first-party template references, and provider-template escape
  hatches.
- Correlate delivery, bounce, block, spam-report, and engagement events through the SendGrid Event
  Webhook.
- Keep API keys, SendGrid request objects, template IDs, categories, and custom arguments out of
  feature contracts unless exposed through an explicit provider escape hatch.

## Twilio SMS plugin

The Twilio plugin will:

- Use Twilio Programmable Messaging through a Messaging Service for production SMS.
- Normalize destination phone numbers to the Doxa phone-number contract and transmit E.164 to
  Twilio.
- Track queued, sent, delivered, undelivered, and failed outcomes through status callbacks.
- Preserve opt-out and permanent-rejection outcomes so they are not retried as transient failures.
- Keep account credentials, messaging-service identifiers, Twilio message objects, and error
  payloads behind the plugin boundary.

Compliance onboarding, sender registration, consent, quiet hours, and opt-out behavior are
configuration and operational requirements of the plugin, not details applications may bypass.

## Testing

Doxa's mail and SMS fakes must support assertions for queued messages, recipients, templates,
content, causal metadata, provider-independent delivery transitions, retry classification, and
verified webhook handling.

Provider sandbox or test modes supplement these fakes but do not replace framework-level tests.

## References

- [SendGrid Mail Send API](https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send)
- [SendGrid Event Webhook](https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/event)
- [Twilio Message resource](https://www.twilio.com/docs/messaging/api/message-resource)
- [Twilio Messaging Services](https://www.twilio.com/docs/messaging/services)
