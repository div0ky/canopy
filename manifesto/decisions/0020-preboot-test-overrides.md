# 0020: Apply Test Overrides Before Boot

- **Status:** Accepted
- **Accepted:** 2026-07-10
- **Scope:** MVP
- **Decision owners:** Doxa maintainers

## Decision

Doxa test applications apply dependency overrides before boot and validate them as a derived,
test-scoped application graph. Bindings become immutable when boot begins. Tests cannot mutate a
running container.

```ts
const app = await DoxaTest.create(Application)
  .override(PaymentGateway)
  .with(FakePaymentGateway)
  .boot()
```

## Derived test graph

An override does not mutate the canonical production manifest. `@doxajs/testing` creates a derived
test graph with provenance linking every replacement to its production binding and test source. The
derived graph receives the same missing-binding, ambiguity, cycle, ownership, and scope-leak
validation as production.

Each test application owns its derived graph, singleton instances, execution scopes, fakes, event
records, clocks, and lifecycle. Concurrent test applications cannot observe or mutate one another's
overrides.

## Immutability

Override declaration closes when test boot begins. The running test application provides no
`container.set()`, rebinding, monkey-patching, or global fake registration. A test that needs a
different graph boots another lightweight test application.

Focused services remain directly constructible with ordinary fakes and do not require a Doxa test
application merely to exercise isolated business logic.

## Consequences

- Test graphs retain production container semantics.
- Override failures occur before application behavior runs.
- Concurrent tests remain isolated.
- Tests cannot model behavior by mutating dependencies halfway through an execution.
- Test startup must be lightweight enough to make multiple purpose-built graphs practical.

## Required implementation proof

The MVP must prove:

1. A port and a concrete dependency can each be replaced before boot.
2. Invalid override scopes, cycles, and ambiguous bindings fail before test startup.
3. Production manifest and registry artifacts remain unchanged.
4. Concurrent test applications use different overrides without leakage.
5. Override attempts after boot fail with an actionable immutable-graph diagnostic.
6. Test shutdown disposes overridden and production resources exactly once.
7. A focused service unit test runs through direct construction without the container.

## References

- [Class-first container](0011-class-first-oop-container.md)
- [Path-independent services and testing](0016-path-independent-structure-autowired-services.md#testing)
- [Public testing package](0018-public-package-surface.md)
- [Doxa specification roadmap](../specifications.md#operations-and-developer-experience)
