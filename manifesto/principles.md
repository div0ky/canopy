# Canopy Principles

These principles are the working tests derived from the [Canopy Manifesto](index.md). They are not
a second manifesto. They exist to make the manifesto useful when choosing APIs, dependencies, and
runtime behavior.

## 1. Canopy owns application semantics

Application code should speak in Canopy and domain vocabulary. A dependency may execute the work,
but it must not decide what a controller, action, model, job, listener, transaction, or application
lifecycle means.

If replacing an infrastructure engine requires rewriting feature code, its boundary has leaked.

## 2. The correct path is the short path

Safe defaults should require less code than bypassing them. Transactions, validation,
authorization, context propagation, durable side effects, observability, and graceful shutdown
should compose through the ordinary programming model.

An escape hatch can be available without becoming the path examples teach first.

## 3. Automatic behavior must remain explainable

Automation is welcome when its phase, ordering, inputs, outputs, and failure behavior are known.
Every automatic behavior should be visible in documentation and inspectable through diagnostics.

If the framework cannot explain what it did, the behavior is too magical.

## 4. Features describe capabilities, not assembly

A feature should reveal the domain operations and interfaces it offers. It should not read like a
manual wiring diagram for routers, database clients, queues, telemetry exporters, and shutdown
hooks.

Infrastructure assembly belongs at the application boundary.

## 5. One concept gets one dominant vocabulary

Canopy should not expose several equivalent ways to express routine work. Aliases and parallel
abstractions increase the amount a developer must learn and make tooling less decisive.

When the ecosystem uses conflicting terms, Canopy chooses one and translates at the adapter
boundary.

## 6. Persistence is explicit about durability

Models represent durable domain state, not convenient wrappers around database records. Mutating
operations use a defined unit of work. Entity-state persistence, journal entries, and outbox
messages must agree atomically about what happened.

Lifecycle hooks may participate in defined phases, but they must not hide remote side effects
inside an ambiguous save operation.

## 7. Context follows the work

Actor, tenant, correlation, causation, locale, trace, and other execution metadata should flow
through requests, actions, events, and jobs without application code repeatedly forwarding it.

Propagation rules must be deterministic, and intentional context changes must be visible.

## 8. Boundaries are protected by contracts

An adapter is justified when a dependency's native API would otherwise shape application code.
The contract should model the capability Canopy promises, not every feature of every possible
implementation.

Adapters earn their keep through conformance suites, framework fakes, and replaceability.

## 9. Compatibility is a framework responsibility

A Canopy release is a tested system, not a suggestion that a set of semver ranges might coexist.
Dependency selection, version alignment, configuration defaults, failure behavior, and upgrade
notes belong to the framework release.

Applications upgrade Canopy. They should not independently reconstruct Canopy's compatibility
matrix.

## 10. Tooling is part of the framework

Diagnostics, generators, test harnesses, contract output, and lifecycle inspection are not polish
to add after the runtime works. They are how a convention-heavy framework stays understandable.

Every major abstraction should answer: how will a developer inspect, generate, fake, and debug it?

## 11. The kernel grows only from demonstrated need

Canopy should implement the smallest application kernel that can uphold its programming model.
Focused libraries remain preferable for focused technical work.

New kernel concepts require an application-level capability that cannot be expressed coherently by
an existing concept or an adapter.

## 12. Coherence outranks surface area

A smaller set of deeply integrated capabilities is more valuable than a longer feature checklist.
Canopy should add a capability only when it participates in the same lifecycle, context, failure,
testing, and observability model as the rest of the framework.

## 13. Paths organize people, not runtime behavior

Feature declarations and imports define application ownership. Folder and file paths may guide
developers, generators, and source diagnostics, but they must not activate behavior, select scope,
or change manifest identity.

Concrete collaborators should be autowired from declared roots and remain directly unit testable.
Cross-feature sharing must be intentional rather than emerge from a global service namespace.

## 14. Opinionated, safe magic is the product

Canopy should decide every routine choice it can decide safely. It should infer behavior when the
compiler can prove the result, generate repetitive declarations when explicit artifacts are still
valuable, and fail before boot when an application is ambiguous or unsafe.

The ordinary path must be difficult to misuse and have one consistent shape that is equally clear
to developers, the compiler, and Cultivate. If Cultivate must guess which of several equivalent
patterns an application intended, Canopy has failed to be opinionated enough.

Magic is good when it removes incidental decisions while remaining deterministic, inspectable,
and explainable. Ceremony is justified only when it communicates consequential intent that Canopy
cannot safely infer.

## A decision test

Before adopting a framework design, ask:

1. Does application code use Canopy and domain vocabulary?
2. Is there one obvious path for ordinary work?
3. Can a developer explain its lifecycle and failure behavior?
4. Can diagnostics show what the framework resolved or executed?
5. Can tests replace it through a Canopy-owned fake or override?
6. Does it preserve transaction and delivery guarantees?
7. Does it keep infrastructure types out of feature code?
8. Can Canopy maintain its compatibility contract over time?
9. Is the capability worth increasing the kernel's conceptual size?
10. Is the ordinary API obvious, safely magical, hard to misuse, and deterministic enough for
    Cultivate to understand without guessing?

A proposal that repeatedly fails these questions is not yet a Canopy design, even if its local API
looks convenient.
