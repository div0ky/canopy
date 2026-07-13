# Realtime Broadcasting

This specification defines Doxa's application-facing broadcasting contract, the Keryx server
adapter, and the `@doxajs/realtime` subscriber client. It is normative for implementations of the
accepted [Keryx decision](../decisions/0028-keryx-realtime-broadcasting.md).

## Event contract

An event opts into queued broadcasting by implementing `ShouldBroadcast`, or synchronous
broadcasting by implementing `ShouldBroadcastNow`. Both capabilities require `broadcastOn()` and may
customize the stable event name and JSON payload with `broadcastAs()` and `broadcastWith()`. The
default event name is the manifest event ID and the default payload is `event.payload`.

`broadcastOn()` returns one or more `Channel`, `PrivateChannel`, or `PresenceChannel` values. Empty,
invalid, or non-JSON results fail the dispatch. Provider types never appear in application events.

`ShouldBroadcast` creates `doxa.queue` work. Inside a Unit of Work that work is written to the
transactional outbox and is not eligible before commit. A rollback discards it. Outside a Unit of
Work it is submitted directly to the selected queue. `ShouldBroadcastNow` calls the selected
broadcast transport in the current execution and propagates transport failures to the dispatcher.
`ShouldDispatchAfterCommit` still controls the event as a whole; Doxa stages queued broadcast work
once and does not duplicate it when after-commit listeners run.

## Channels and authorization

Public `Channel` subscriptions require no authorization. `PrivateChannel` and `PresenceChannel`
subscriptions require the `broadcast.subscribe` ability. The policy receives a
`BroadcastSubscriptionResource` containing the exact channel name and kind. Missing policies,
denials, invalid channel names, and kind mismatches fail closed.

Because channel selection may depend on event data, every application containing broadcast events
must declare a policy for `broadcast.subscribe`, even when its current events only use public
channels. This keeps later private-channel edits fail-closed at compilation rather than silently
creating an unprotected subscription path.

Connection admission resolves Doxa authentication once from the WebSocket upgrade request. Every
subscribe and unsubscribe command is then admitted as a fresh Doxa execution using that actor,
authentication, tenant, and connection correlation context. Connection identity is never treated as
an execution scope.

Cookie-authenticated upgrade requests require the same trusted `Origin` validation as unsafe HTTP
requests even though the WebSocket handshake uses `GET`. Upgrade admission must not rotate a browser
session unless the replacement cookie can be returned as part of the handshake; the first-party
adapter authenticates upgrades without rotation and refreshes ordinary session activity instead.
Bearer-authenticated upgrades do not acquire cookie authority from the browser.

Presence membership exposes only the admitted `ActorRef`. Applications that need public profile data
broadcast a separate, explicitly shaped event; Keryx does not serialize identities, sessions,
credentials, policy decisions, or execution context to clients.

## Wire protocol

Keryx uses JSON WebSocket frames. Client commands are `subscribe`, `unsubscribe`, and `ping`. Server
frames are `connected`, `subscribed`, `unsubscribed`, `event`, `presence_joined`, `presence_left`,
`pong`, and `error`. Every frame has `protocol: 1`. Unknown protocol versions, commands, fields with
invalid types, malformed JSON, oversized frames, and unsupported binary data receive an error and
close when continuing would be unsafe.

An event frame contains a unique message ID, stable event name, channel, JSON data, and ISO-8601
occurrence time. It contains no transport-native object and no Doxa execution or credential data.

## Delivery, ordering, and failures

Broadcasting is at-most-once from Keryx to each currently connected subscriber. It is not durable
for disconnected clients. Queued broadcast intent is durable until Keryx accepts the publish call;
queue retry and terminal-failure rules apply to adapter failures. Applications requiring replay use
a durable query or domain journal and treat realtime delivery as an invalidation or notification.

Keryx preserves publish-call order per connection. Doxa makes no global ordering promise across
queue workers or server replicas. Event IDs let clients suppress duplicates when infrastructure
retries race with a disconnect.

Slow or failed sockets are closed without failing delivery to healthy subscribers. A server-level
publish failure rejects the transport call. Heartbeats remove dead connections. Shutdown stops new
connections, drains active publish calls, closes sockets, and releases the listener.

## Reconnect and subscriptions

`@doxajs/realtime` reconnects with capped exponential backoff and jitter, then resubscribes to all
locally active subscriptions. Consumers receive no synthetic replay. Explicitly leaving the final
listener for a channel sends `unsubscribe`; explicitly disconnecting disables reconnect.

## Inspection and testing

The manifest records `broadcast: false | queued | now` for every event. Observations cover queued,
published, subscription, authorization, and failure phases without payload or credential leakage.
`FakeBroadcastTransport` records immutable messages and exposes connection/subscription helpers so
tests can assert broadcasts and authorization without a WebSocket engine.
