# 0006: Use Standard Schema with Zod 4 as the Validation Default

- **Status:** Accepted
- **Accepted:** 2026-07-10
- **Decision owners:** Doxa maintainers

## Decision

Doxa's public validation boundary will accept Standard Schema-compatible validators. Doxa will pin,
document, generate, and teach Zod 4 as the default schema implementation.

Doxa owns validation phases, input-source selection, coercion policy, stable issue codes, error
documents, localization, diagnostics, OpenAPI or contract generation, and testing assertions. Zod
supplies the default schema-definition and validation algorithms.

## Boundary

- Generated Doxa applications use Zod 4.
- Doxa APIs consume the Standard Schema interface rather than requiring `ZodType` internally.
- Feature code may infer TypeScript input and output types from its selected schema.
- Alternative Standard Schema implementations are an escape hatch, not equally promoted defaults.
- Raw Zod issues are normalized before they reach HTTP responses, logs, or Doxa test assertions.
- A dependency upgrade cannot silently change Doxa coercion, error, or serialization semantics.

## Consequences

- Applications receive a mature, expressive TypeScript schema authoring experience.
- Doxa retains ownership of framework behavior around validation.
- The Standard Schema boundary prevents every validator from requiring a bespoke adapter.
- Supporting an escape-hatch validator still requires it to pass Doxa's validation conformance
  suite.

## References

- [Standard Schema](https://standardschema.dev/)
- [Zod 4](https://zod.dev/packages/zod)
