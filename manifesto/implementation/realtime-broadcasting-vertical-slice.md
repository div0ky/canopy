# Realtime Broadcasting Vertical Slice

## Status

Implemented on 2026-07-11 against the normative
[realtime broadcasting specification](../specifications/realtime-broadcasting.md).

## Proven path

- `ShouldBroadcast` and `ShouldBroadcastNow` compile into explicit event manifest facts.
- Queued broadcasts use the existing queue envelope and Unit of Work outbox path; synchronous
  broadcasts publish in the current execution.
- `BroadcastTransport` is selected as a singleton provider capability and is required whenever the
  manifest contains a broadcast event.
- Keryx admits upgrade requests through Doxa authentication, creates a fresh execution for every
  subscription command, and authorizes private and presence channels with `broadcast.subscribe`.
- Keryx implements strict versioned JSON frames, public/private/presence subscriptions, presence
  membership, heartbeat removal, slow-subscriber closure, lifecycle drain, and clean shutdown.
- `@doxajs/realtime` provides typed event maps, public/private/presence subscriptions, explicit
  leave/disconnect, capped jittered reconnect, and automatic resubscription.
- `FakeBroadcastTransport` proves publish assertions and policy-backed subscription admission
  without an engine.
- Praxis generates queued or synchronous broadcast events and `event:list` reports delivery mode.

## Executable evidence

`tests/broadcasting.test.ts` proves compiler facts, queued and synchronous runtime paths, fake
transport assertions, private-channel authorization, and a real Keryx-to-realtime-client WebSocket
round trip. The repository verification gate covers package boundaries, publishable declarations,
documentation links, formatting, linting, coverage, and dependency security.

## Deliberate guarantees

Realtime socket delivery is at-most-once and non-replayable. Transactional queued intent remains
durable until the broadcast transport accepts it. Per-connection publish-call order is preserved;
cross-worker and cross-replica total ordering is not promised.
