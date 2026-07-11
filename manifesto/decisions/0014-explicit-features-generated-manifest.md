# 0014: Compose Explicit Features into One Generated Application Manifest

- **Status:** Accepted
- **Accepted:** 2026-07-10
- **Scope:** MVP
- **Decision owners:** Canopy maintainers

## Decision

Canopy applications will be composed from explicit, class-first feature boundaries. The application
root explicitly selects its features, and each feature explicitly declares its framework-facing
classes in role-based arrays. Canopy's build-time compiler automatically follows and wires the
concrete dependency graph beneath those declarations. The compiler will produce one versioned,
framework-owned application manifest consumed by runtime boot, adapters, tests, diagnostics, the
CLI, and Cultivate.

This direction is summarized as:

> Explicit feature declarations, automatic dependency wiring beneath them.

The role-array authoring model is accepted for the MVP. Exact override syntax and the complete
manifest schema remain specification work. This decision constrains those specifications without
claiming they are complete.

## Application composition

The application root must make its selected features visible without relying on package side
effects, whole-workspace scanning, or runtime discovery. A feature owns a coherent set of models,
actions, queries, routes, policies, providers, events, listeners, observers, jobs, and schedules.

The MVP authoring shape is a concise, class-first table of contents:

```ts
export class AccountsFeature extends Feature {
  id = 'accounts'

  models = [User]
  actions = [RegisterUser, ChangePassword]
  queries = [FindUser]
  policies = [UserPolicy]
  observers = [UserObserver]
  listeners = [SendWelcomeEmail]
  routes = [AccountRoutes]
}

export class Application extends CanopyApplication {
  features = [AccountsFeature, BillingFeature, NotificationsFeature]
}
```

The arrays declare ownership and make the feature's application surface readable in one place. The
class defines its own role and behavior; the array category lets the compiler validate the
declaration and gives humans an intentional overview. Generators must create the class and update
the owning feature declaration as one planned operation.

Applications may explicitly replace or bind capabilities when constructor autowiring is
insufficient. Those exceptions must remain visible in the generated manifest, but they should not
clutter ordinary feature declarations.

## Declaration-only Application class

The Application class is also compile-time metadata. It declares the stable application identity,
selected Features, and other supported composition fields. Neither the compiler nor runtime
constructs the Application or executes its code to discover the application graph.

The Application must not define a constructor, `register()` method, `boot()` method, dynamic Feature
selection, environment-dependent branching, or arbitrary executable configuration. The compiler must
reject unsupported members and expressions with source-aware diagnostics.

Booting an Application produces a separate runtime instance. That runtime owns lifecycle state,
admission, execution scopes, infrastructure instances, readiness, draining, shutdown, and disposal.
`Canopy.boot(Application)` produces that runtime and resolves only at readiness; the declaration
object and mutable runtime are never the same object.

## Declaration-only Feature classes

A Feature class is compile-time application metadata. Canopy's compiler reads its supported
declarative fields, but neither the compiler nor runtime constructs the Feature or executes
application code to discover its contents.

Feature classes must not define constructors, `register()` methods, `boot()` methods, dynamic
registration, environment-dependent branching, or arbitrary executable configuration. A Feature body
is limited to the declarative fields and binding expressions recognized by the Canopy compiler.

Startup, readiness, draining, shutdown, and disposal behavior belongs to explicitly declared
provider or adapter classes. Their dependencies and lifecycle phases must appear in the manifest.
This preserves Laravel-like organization without allowing service-provider hooks to create a second
application graph during boot.

## Feature boundaries

Features are ownership and composition boundaries, not Nest-style module namespaces. Canopy will not
create chains of module imports and exports that indirectly control provider visibility.

Injectable classes and tokens remain private to their Feature by default. A Feature exposes an
intentional cross-Feature API through `provides`, which accepts concrete classes, abstract-class
ports, and typed Canopy tokens equally:

```ts
export class AccountsFeature extends Feature {
  provides = [AccountDirectory]
}
```

Consumers inject the concrete `AccountDirectory` directly. They do not import `AccountsFeature` or
declare a module dependency. The Application selects both Features, and the compiler resolves the
public identity through the manifest.

Abstract ports are introduced when the domain needs polymorphism, replacement, isolation, or an
infrastructure boundary—not merely because a dependency crosses a Feature. When a port is needed,
`bindings` selects its implementation while `provides` controls its visibility:

```ts
export class BillingFeature extends Feature {
  bindings = [bind(PaymentGateway).to(StripePaymentGateway)]

  provides = [PaymentGateway]
}
```

`bindings` answers which implementation satisfies an identity. `provides` answers whether other
Features may depend on that identity. Ambiguous ownership, competing providers, and access to
private identities fail compilation.

## Build-time registration

The role arrays are authoritative for framework-facing behavior. The compiler will inspect each
declared class, verify its role, and recursively follow its concrete constructor dependencies.
Reachable concrete dependencies are autowired; abstract ports, aliases, values, factories, and
unusual scopes require explicit bindings.

The compiler may inspect the TypeScript program to find likely omissions, but an undeclared class
must produce a diagnostic and suggested fix rather than silently becoming active application
behavior. Folder names do not determine Feature ownership or class role. Registration must not
depend on runtime reflection, legacy decorator metadata, filesystem scanning during boot, or
importing every application module for side effects.

Build-time diagnostics must report ambiguous ownership, duplicate identifiers, invalid class roles,
missing bindings, dependency cycles, and declarations that cannot be reached from the application
root.

## Fail-closed static compilation

The compiler must produce a complete graph through static analysis or fail. Declaration fields may
use literals, direct class references, and compiler-recognized declarative helpers. They must not
depend on environment variables, runtime conditionals, dynamic imports, asynchronous discovery,
arbitrary function execution, mutable global state, or other values the compiler cannot prove.

Environment-specific values belong in validated runtime configuration. Environment-specific
infrastructure implementations may be selected through explicit, statically represented binding
contracts, but the existence and identity of application capabilities must not change through hidden
runtime branching.

Unsupported or ambiguous expressions receive source-aware diagnostics. Canopy must not fall back to
boot-time reflection, filesystem scanning, opportunistic registration, or a partial best-effort
manifest.

## Semantic TypeScript compilation

Canonical artifact emission requires a semantically valid strict TypeScript application project. The
Canopy compiler uses TypeScript's Program, symbol graph, module resolution, and type checker to
resolve class identity, inheritance, constructor dependencies, abstract ports, capability
interfaces, listener handler parameters, Feature role arrays, generic public types, and package
ownership.

Regexes, filename inference, syntax-only scanning, and textual type-name matching are not valid
sources of manifest semantics. Syntax errors, unresolved symbols, and semantic TypeScript errors in
the application project prevent canonical artifact emission. Canopy diagnostics are reported
alongside TypeScript diagnostics with source locations and remediation.

Watch mode may retain the last known-good artifacts for inspection, but it must mark them stale and
must not boot them as though they describe the current source. TypeScript project references may
isolate unrelated workspace packages from the application compilation while preserving complete
semantic checking of the application graph.

The TypeScript version is pinned by the Canopy release compatibility contract. Compiler behavior is
not supported against arbitrary application-selected TypeScript versions.

## One application manifest

The generated manifest is the sole framework-owned representation of the composed application. It
must be versioned and must include, where applicable:

- Stable capability IDs and human-readable names.
- Owning application, feature, and package.
- Exact source provenance.
- Role and lifecycle phase.
- Constructor dependencies, bindings, and scopes.
- Input and output schemas.
- Relationships among routes, operations, policies, models, events, observers, listeners, jobs, and
  schedules.
- Required infrastructure capabilities and adapter provenance.
- Sensitivity, mutability, and diagnostic metadata.

The runtime consumes this manifest; it does not reconstruct a second application graph. The CLI,
tests, diagnostics, and Cultivate may expose different views, but their facts must derive from the
same representation.

## Immutable application graph

The canonical application graph is immutable after compilation. Once boot begins, neither
application code nor adapters may add, remove, replace, or reinterpret Features, providers,
bindings, routes, policies, events, listeners, observers, jobs, schedules, or other manifest
capabilities.

The runtime exposes no dynamic container rebinding, listener registration, route registration,
plugin activation, or Feature mutation API. Test overrides produce a separate validated graph before
boot and do not weaken production immutability.

Configuration values, database records, tenant state, feature-flag values, schedule state, and other
business data may change normally. They may influence behavior through declared policies and
services but cannot secretly redefine which application capabilities exist.

Development hot reload compiles a new graph and boots a replacement runtime. It does not patch the
running graph in place. Installing or removing a plugin likewise requires compilation and runtime
replacement.

## Stable manifest identity

Every framework-facing declaration must provide an explicit stable local ID. Feature IDs scope their
declarations, and the compiler adds the role to produce a canonical manifest ID:

```ts
export class OrdersFeature extends Feature {
  id = 'orders'
}

export class OrderShipped extends Event {
  static id = 'order-shipped'
}
```

```text
event:orders/order-shipped
```

Canonical identity must not derive from a filename, directory, source location, class name, array
position, or discovery order. Moving or renaming source changes provenance only; it must not change
queued payloads, journal references, outbox records, traces, diagnostics, or other durable links.

Feature IDs and local declaration IDs are mandatory. Generators create them automatically. The
compiler must reject missing IDs, duplicate canonical IDs, invalid role prefixes, and unstable or
computed ID expressions before emitting the manifest.

## Generated manifest artifacts

The compiler emits two artifacts representing one logical application graph:

```text
.canopy/
├── manifest.json
└── registry.mjs
```

`manifest.json` is the canonical semantic manifest. It must be deterministic, versioned,
serializable, and safe for the CLI, diagnostics, tests, and Cultivate to read without importing or
executing application code.

`registry.mjs` is a constructor-only linkage table. It may import compiled application classes and
map stable manifest IDs to their runtime constructors or factories. It must not declare roles,
dependencies, scopes, policies, lifecycle phases, schemas, or other semantic facts absent from
`manifest.json`.

Both artifacts carry the same build hash. Runtime boot must reject a missing artifact, an unknown
artifact version, an ID mismatch, or unequal build hashes rather than combine stale metadata with
new application code.

The registry is not a second manifest. All behavior represented through its constructors must be
authorized by a corresponding canonical manifest entry.

The `.canopy/` directory is reproducible build output and is not committed to source control.
Development watch mode, builds, tests, packaging, CLI inspection, and Cultivate generate or require
current artifacts. Production artifacts include the generated files required by runtime boot.

Developers must never hand-edit the manifest or registry. CI verifies deterministic generation.
Source schema, application declarations, and reviewed SQL migrations remain committed inputs; the
generated application graph does not.

## Compilation ownership

Canopy tooling owns compilation before runtime:

- `canopy dev` performs an initial compile and watches application source.
- `canopy build` compiles before packaging.
- `canopy test` compiles the test application before execution.
- `canopy inspect:*` and Cultivate compile or verify artifact freshness before inspection.
- CI regenerates artifacts and verifies deterministic output.

`Canopy.boot()` consumes and validates existing artifacts only. It never imports the compiler,
analyzes TypeScript, repairs stale output, or emits a manifest. Production runtime images do not
require compiler or TypeScript packages.

Missing, incompatible, or mismatched artifacts fail boot with a normalized diagnostic that names the
tooling command required to regenerate them. Custom hosts must include compilation in their build
pipeline.

## Manifest format compatibility

The manifest format is versioned independently from Canopy package releases. Every manifest must
identify at least:

```json
{
  "formatVersion": 3,
  "applicationId": "acme",
  "frameworkVersion": "0.1.0",
  "compilerVersion": "0.1.0",
  "buildHash": "..."
}
```

`formatVersion` governs interpretation of the canonical JSON contract. Framework, compiler, plugin,
adapter, and application package versions provide provenance but do not substitute for format
compatibility.

Runtime, CLI, tests, diagnostics, and Cultivate must explicitly declare the format versions they
support and reject unknown newer or otherwise incompatible manifests. Consumers must not guess,
partially interpret, or silently downgrade an unsupported application graph.

Breaking manifest changes increment `formatVersion`. Additive optional fields may remain within a
format version only when existing consumers can safely ignore them without changing the meaning of
known fields. Compatibility migrations must be deliberate, testable framework tooling rather than ad
hoc runtime coercion.

## Consequences

- Application composition remains explicit at its meaningful architectural boundaries.
- Each feature remains a readable table of contents for its framework-facing behavior.
- Constructor-reachable concrete services require no provider registration boilerplate.
- Generators and compiler conventions become part of the supported programming contract.
- Build failures replace many late boot-time discovery failures.
- Manifest compatibility and source provenance require deliberate versioning and conformance tests.
- Highly dynamic runtime registration is not part of the primary MVP programming model.

## Alternatives rejected for the MVP

- **Manual provider registration for every dependency:** explicit but too repetitive and hostile to
  the intended Laravel-like developer experience.
- **Unrestricted whole-project discovery:** convenient initially, but obscures ownership and makes
  composition depend on incidental filesystem contents.
- **Runtime reflection or decorator metadata:** conflicts with deterministic, reflection-free boot
  and makes tooling reconstruct runtime behavior.
- **Nest-style module import and export chains:** makes capability ownership and visibility harder
  to understand than one explicit application graph.
- **Separate manifests for runtime and tooling:** guarantees drift between what the application
  executes and what developers or agents inspect.

## Required implementation proof

The MVP must prove:

1. An application explicitly composes multiple features into one graph.
2. Application constructors, methods, and executable configuration are rejected with source-aware
   diagnostics.
3. Boot creates a distinct runtime object without constructing the Application declaration.
4. Each feature explicitly declares framework-facing classes in role-based arrays that generators
   can update safely.
5. Feature constructors, methods, and executable configuration are rejected with source-aware
   diagnostics.
6. Concrete dependencies beneath those declarations are autowired without provider arrays or runtime
   reflection.
7. Explicit bindings override autowiring predictably and remain inspectable.
8. Duplicate, unreachable, ambiguously owned, and cyclic declarations fail at build time with
   source-aware diagnostics.
9. Dynamic, environment-dependent, or otherwise unprovable declaration expressions fail with
   source-aware diagnostics and never trigger runtime discovery.
10. Syntax, resolution, and semantic TypeScript errors prevent canonical artifact emission.
11. Listener, capability, constructor, and ownership relationships resolve through TypeScript symbol
    identity rather than textual names.
12. Moving or renaming a declaration preserves its canonical manifest ID while updating source
    provenance.
13. Runtime boot, CLI inspection, tests, diagnostics, and Cultivate-compatible inspection report
    facts from the same versioned manifest.
14. Runtime attempts to register or rebind graph capabilities fail with an immutable-graph
    diagnostic.
15. Development reload produces a newly compiled graph and replacement runtime.
16. CLI and Cultivate-compatible inspection can read `manifest.json` without importing application
    code.
17. Repeated compilation from identical source produces byte-stable gitignored artifacts.
18. Production runtime boots without compiler or TypeScript packages installed.
19. Official tooling compiles or verifies artifacts before every runtime-consuming workflow.
20. Runtime rejects stale, mismatched, or semantically expanded registry artifacts.
21. Every manifest consumer rejects unsupported format versions before interpreting application
    entries.
22. A feature can collaborate across an explicit capability without module re-export mechanics.
23. A Feature can expose a concrete service directly without introducing an abstract port.
24. Concrete, abstract, and token identities receive identical visibility validation through
    `provides`.
25. Manifest generation is deterministic across machines and repeated builds.

## Revisit when

- TypeScript source analysis cannot reliably validate role arrays or follow constructor
  dependencies.
- Automatic dependency wiring creates surprising behavior that explicit diagnostics cannot explain.
- Manifest generation becomes dependent on executing untrusted application code.
- A required deployment or plugin model cannot compose into one deterministic application graph.

## References

- [Canopy architecture](../architecture.md#the-application-manifest)
- [Canopy specification roadmap](../specifications.md#foundation)
- [Class-first OOP and container decision](0011-class-first-oop-container.md)
- [Path-independent structure and autowired services](0016-path-independent-structure-autowired-services.md)
- [Cultivate decision](0013-first-party-ai-engineering-mcp.md)
