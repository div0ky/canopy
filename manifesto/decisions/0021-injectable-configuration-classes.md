# 0021: Use Injectable Configuration Classes

- **Status:** Accepted
- **Accepted:** 2026-07-10
- **Scope:** MVP
- **Decision owners:** Canopy maintainers

## Decision

Canopy configuration is declared through typed classes, resolved before application-service
construction, and injected directly as frozen runtime-specific objects. Canopy infers the ordinary
environment contract from class and property names, TypeScript types, optionality, and defaults.

```ts
export class AppConfig extends Configuration {
  environment: 'development' | 'test' | 'production' = 'development'
  port: Port = 3000
  webhookSecret?: SecretString
}
```

Ordinary application code injects the group itself:

```ts
export class CheckoutService {
  constructor(private readonly app: AppConfig) {}

  execute(): void {
    if (this.app.environment === 'production') {
      // ...
    }
  }
}
```

There is no string-keyed `ConfigService#get()`, `config.is()`, generic type assertion, or manual
provider registration in the primary programming model. Normal property access and TypeScript
narrowing provide the application-facing DX.

## Declared configuration groups

The Application and selected Features explicitly declare the groups they make available:

```ts
export class Application extends CanopyApplication {
  configs = [AppConfig]
  features = [OrdersFeature, BillingFeature]
}
```

```ts
export class BillingFeature extends Feature {
  configs = [BillingConfig]
}
```

Only groups declared by the Application or selected Features are resolved and injectable. A
configuration class is declaration-only: it cannot define a constructor, methods, dynamic source
selection, arbitrary executable factories, or runtime registration.

## Convention-derived environment contract

Canopy derives the default environment name from the configuration class and property:

- `AppConfig.environment` becomes `APP_ENVIRONMENT`.
- `AppConfig.port` becomes `APP_PORT`.
- `AppConfig.webhookSecret` becomes `APP_WEBHOOK_SECRET`.
- `BillingConfig.currency` becomes `BILLING_CURRENCY`.

The `Config` suffix is removed, camel case becomes screaming snake case, and group plus property
form the complete environment key. Generated documentation, `.env.example`, diagnostics, and
Cultivate use the same deterministic mapping.

The compiler infers ordinary validation semantics:

- A string, number, or boolean type selects the corresponding strict parser.
- A literal union selects its allowed values.
- A property initializer supplies the default.
- `?` makes the value optional.
- `Port` applies Canopy's validated port contract.
- `SecretString` marks the value as sensitive and redacted.

Canopy may provide additional first-party semantic scalar types as separately specified public
contracts. Complex values use the accepted Standard Schema escape hatch:

```ts
export class CorsConfig extends Configuration {
  origins = schema(z.array(z.url())).default([])
}
```

Explicit schemas are available when inference cannot express the real contract; they are not
required ceremony for ordinary scalar configuration.

## Sources and precedence

The official Node host resolves configuration in this precedence order, highest first:

1. Explicit boot or test overrides.
2. Existing `process.env` values.
3. An optional `.env` file at the exact application workspace root.
4. Declared property defaults.

The host does not walk arbitrary parent directories looking for `.env`. It reports the exact path it
checked. Loading `.env` does not mutate `process.env`; Canopy parses it into a private source map
and resolves only environment keys belonging to declared configuration groups.

## Validation and runtime materialization

Configuration resolution occurs after manifest and graph validation but before construction of the
application singleton graph. Canopy reports all configuration errors together with the group,
property, environment key, declaration source, and value source. Sensitive values are never included
in errors or diagnostics.

The runtime materializes one frozen instance of each declared configuration class without executing
application configuration code. The class itself is the injection identity. Changing a source value
requires a new runtime; configuration does not mutate in place or alter the immutable application
graph.

The manifest records declarations, types, defaults, source mappings, optionality, and sensitivity
classifications. It never records resolved secret values.

## Testing

Test applications provide typed configuration overrides before boot. Overrides pass through the same
parsers, schemas, redaction, and immutability rules as environment values and remain isolated to the
derived test application.

## Consequences

- Ordinary configuration requires little framework-specific syntax.
- Environment naming becomes predictable across applications and agents.
- Application code receives typed properties rather than strings and assertions.
- Configuration groups remain explicit and inspectable without exposing every process variable.
- Unusual parsing remains possible through Standard Schema without defining the common path.

## Required implementation proof

The MVP must prove:

1. Application- and Feature-declared groups are discovered without executing their classes.
2. Environment names derive deterministically from group and property names.
3. Defaults, unions, optional properties, `Port`, and `SecretString` validate correctly.
4. Process environment overrides `.env`, which overrides defaults.
5. Only declared environment keys become available through Canopy configuration.
6. Configuration failures occur before singleton construction and report all invalid fields.
7. Injected configuration instances are typed, frozen, runtime-specific, and directly accessible.
8. Secrets never appear in manifests, errors, diagnostics, logs, or generated examples.
9. Concurrent test applications use isolated validated overrides.
10. A complex Standard Schema field behaves consistently with inferred fields.

## References

- [Canopy architecture](../architecture.md#configuration)
- [Standard Schema and Zod](0006-standard-schema-zod-validation.md)
- [Explicit Application and Feature declarations](0014-explicit-features-generated-manifest.md)
- [Pre-boot test overrides](0020-preboot-test-overrides.md)
- [NestJS configuration](https://docs.nestjs.com/techniques/configuration)
