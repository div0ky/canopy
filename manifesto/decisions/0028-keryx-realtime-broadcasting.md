# 0028: Name Doxa's Realtime Broadcasting Implementation Keryx

- **Status:** Accepted
- **Accepted:** 2026-07-11
- **Scope:** Optional post-MVP WebSocket and broadcasting capability
- **Decision owners:** Doxa maintainers

## Decision

Doxa's first-party WebSocket and broadcasting server implementation will be named **Keryx**. The
server package will be `@doxajs/keryx`. The browser and other subscriber-facing API will be
published as `@doxajs/realtime`; it will not receive a second product name.

Application code uses the Doxa concept **broadcasting**. It does not depend on Keryx types or names.
`ShouldBroadcast` and `ShouldBroadcastNow` retain their already accepted event semantics; Keryx is
the transport implementation that delivers those broadcasts. Realtime clients express subscriptions
and received events through the same Doxa broadcasting contract.

_Keryx_ is the Greek word for a herald: an exact role name for a component that announces
application events without becoming the application's event model.

## Context

Laravel separates Reverb, its WebSocket server, from Echo, its JavaScript subscription client. Doxa
needs the same separation between the application-level broadcasting vocabulary and the replaceable
transport beneath it, but does not need two branded concepts for a single capability.

The manifesto reserves Laravel-aligned broadcast capabilities while deferring WebSocket and
broadcasting support from the MVP. It also requires one dominant vocabulary and delegates WebSocket
protocols and server mechanics to adapters. A name must therefore identify the first-party server
without leaking its native API into actions, events, listeners, or browser code.

## Boundary

- `@doxajs/keryx` owns the first-party server adapter, connection lifecycle, protocol integration,
  and delivery implementation, as defined by the
  [realtime broadcasting specification](../specifications/realtime-broadcasting.md).
- `@doxajs/realtime` owns the subscriber-facing client API for Doxa broadcasts.
- Doxa core owns event capabilities, authorization integration, execution-context creation, typed
  broadcast contracts, fakes, and diagnostics.
- Application code speaks in terms of events, channels, subscriptions, and broadcasting; it never
  imports Keryx engine types.
- A Keryx connection authenticates at connection admission, but each admitted message creates a
  fresh Doxa execution as required by the actor and execution-context specification.
- The package names do not select a protocol engine or make broadcasting necessary for the MVP
  reference flow. The normative runtime specification defines protocol, authorization, presence,
  reconnect, ordering, delivery, and failure behavior.

## Alternatives considered

- **Keryx plus a separately branded client:** rejected. It duplicates product vocabulary where
  `realtime` clearly describes the client capability.
- **A generic server package such as `@doxajs/realtime-server`:** rejected. It lacks a distinct,
  memorable implementation identity alongside Praxis, Theoria, and Gnosis.
- **A borrowed Laravel name such as Echo or Reverb:** rejected. Doxa should have its own public
  identity and must not imply Laravel compatibility or shared implementation.
- **Expose Keryx as the application programming model:** rejected. This would let transport
  machinery define application semantics, contrary to the adapter boundary.

## Consequences

- Documentation has one application-facing term: broadcasting.
- Keryx can be replaced or supplemented without rewriting application features.
- Realtime clients remain discoverable by purpose and avoid a second term developers must learn.
- Keryx is a public package name and should be treated as a stable contract once published.
- Broadcasting remains optional for applications and outside the MVP viability bar, while its
  implemented runtime behavior is now a stable public contract.

## Required implementation proof

Keryx's specification and implementation proof must show:

1. Authenticated connection admission and channel authorization use Doxa's actor and policy model.
2. Every admitted inbound message receives a fresh execution scope with correct causal context.
3. Broadcasts preserve the accepted queued, synchronous, transaction, journal, and outbox semantics.
4. Browser clients receive typed Doxa broadcast contracts without Keryx engine-type leakage.
5. Doxa-owned fakes and diagnostics can inspect and assert subscriptions, authorization, broadcasts,
   delivery failures, and reconnect behavior.
6. Protocol and server engines are replaceable behind conformance tests.

The
[realtime broadcasting vertical slice](../implementation/realtime-broadcasting-vertical-slice.md)
provides this executable proof.

## References

- [Doxa principles](../principles.md)
- [MVP scope](../mvp.md#deferred-from-the-mvp)
- [OOP and container](0011-class-first-oop-container.md#role-classes-and-capability-traits)
- [Actor and execution context](../specifications/actor-execution-context-authorization.md)
- [Framework name](0027-doxajs-framework-name.md)
