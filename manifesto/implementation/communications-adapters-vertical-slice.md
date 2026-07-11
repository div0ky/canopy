# Communications Adapter Vertical Slice

- **Status:** Implemented proof
- **Completed:** 2026-07-10

Canopy now owns provider-independent mail, SMS, delivery-state, failure-classification, and testing
contracts. Feature-facing types contain no SendGrid or Twilio request, response, template, or error
objects.

The SendGrid adapter uses `POST /v3/mail/send`, isolates recipients into separate personalizations,
correlates `canopy_message_id` through custom arguments, treats `202` as accepted rather than
delivered, classifies HTTP retry behavior, verifies ECDSA P-256 signed event webhooks, requires
batched arrays and stable event IDs, and normalizes delivery, bounce, deferral, suppression, spam,
and unsubscribe outcomes.

The Twilio SMS adapter uses a Messaging Service, E.164 destinations, Basic authentication, status
callbacks, and normalized acceptance/delivery outcomes. It validates `X-Twilio-Signature` using
the canonical URL-plus-sorted-parameters HMAC, and treats error `21610` as a non-retryable opt-out.

First-party fakes capture Canopy messages and return provider-independent acceptances. Adapter
tests use injected fetch implementations and generated signatures; they never contact providers.

Application code now injects `Mailer` and `Sms`. Their `send()` methods require a mutating execution,
stage a `canopy_delivery_messages` row and `canopy.queue` outbox envelope atomically, and return the
application message ID. A failed action rolls back both records. The pg-boss worker invokes the
selected transport with preserved execution context and records provider acceptance in a separate
transaction. Transient `DeliveryError` failures remain retryable; permanent, suppression, and
opt-out outcomes are recorded and complete without pointless retries.

The reference application exposes signed SendGrid and Twilio routes. SendGrid signatures are
checked against the untouched body and bounded to a five-minute timestamp window. Twilio signatures
cover the exact callback URL and sorted form fields. Both normalize into a transactional
`DeliveryLedger` action. Provider event IDs are unique and duplicate callbacks are harmless.

Arbor provides `delivery:list` and `delivery:retry`. Redrive is limited to failed or undelivered
messages, rebuilds a queue envelope with the original actor, authentication, correlation, and trace
context, and atomically resets delivery state with its outbox handoff. Configuration is read from
an explicit option, the environment, or the repository `.env` file.

The required communications behavior is proven. Queue and channel telemetry is emitted through the
Canopy telemetry port. Retention policy and live provider sandbox checks are release gates rather
than application-facing framework gaps.
