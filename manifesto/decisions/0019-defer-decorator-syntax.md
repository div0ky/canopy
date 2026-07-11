# 0019: Defer Canopy Decorator Syntax

- **Status:** Deferred
- **Deferred:** 2026-07-10
- **Target:** After the MVP programming model and semantic compiler stabilize
- **Decision owners:** Canopy maintainers

## Decision

The Canopy MVP does not support decorators as a framework declaration syntax. The primary and only
MVP authoring model uses class roles, Feature role arrays, capability interfaces, constructor
types, explicit stable IDs, declarative bindings, and typed handler methods.

Optional Canopy decorators are deferred rather than permanently rejected.

## MVP boundary

The Canopy compiler does not interpret decorators for framework semantics. It does not depend on
legacy decorator metadata, `emitDecoratorMetadata`, runtime reflection, or a parallel annotation
registry.

Applications may use decorators for unrelated application or library code supported by the pinned
TypeScript toolchain, but those decorators do not change the Canopy manifest.

## Conditions for reconsideration

A future decorator frontend may be considered only when:

- The class-first programming model and manifest schema are stable.
- It compiles into exactly the same canonical manifest.
- It introduces no capability unavailable through the primary syntax.
- It requires no runtime metadata or reflection.
- CLI, diagnostics, tests, and Cultivate report identical semantics regardless of syntax.
- Supporting two syntaxes demonstrably improves developer experience enough to justify the added
  compiler, documentation, migration, and conformance burden.

Decorator syntax remains optional sugar. It cannot replace or weaken the primary non-decorator
model.

## References

- [Class-first OOP and container](0011-class-first-oop-container.md)
- [Explicit Features and generated manifest](0014-explicit-features-generated-manifest.md)
- [Developer experience breaks ties](../index.md#developer-experience-breaks-ties)
