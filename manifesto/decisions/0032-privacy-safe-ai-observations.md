# 0032: Add Privacy-Safe First-Class AI Observations

- **Status:** Accepted
- **Accepted:** 2026-07-16
- **Scope:** Core observation vocabulary and Doxa-owned AI adapter boundaries
- **Decision owners:** Doxa maintainers

## Decision

Doxa will provide typed semantic observations for AI model operations, tool invocations, critic
verdicts, and retries. The default contract records operational metadata and safe outcomes while
excluding prompts, completions, message bodies, tool payloads, phone numbers, and customer PII by
construction.

## Boundary

- AI observations use stable operation, provider, model, tool, and critic identifiers plus latency,
  status, retry count, finish reason, available token counts, and safe outcome metadata.
- AI model, tool, critic, and retry operations are timed spans when invoked through a Doxa-owned
  boundary.
- Prompt bodies, completions, tool arguments/results, SMS content, phone numbers, names, addresses,
  and customer identifiers have no default observation fields.
- Applications may attach only sanitized JSON attributes. Explicit future content capture requires a
  separate decision, per-field policy, size bounds, and stronger access controls.
- Recursive redaction is defense in depth, not the primary privacy mechanism.

## Alternatives considered

- **Generic log attributes only:** rejected because AI operations require stable vocabulary, token
  and retry semantics, and privacy guarantees across adapters.
- **Capture prompts and redact later:** rejected because redaction cannot reliably infer every form
  of customer or business-sensitive content.
- **Provider-specific records:** rejected because provider SDK vocabulary would leak into Doxa roles
  and make cross-provider diagnostics incoherent.

## Consequences

- Theoria and telemetry can explain AI latency, cost drivers, tools, retries, and outcomes without
  retaining customer conversations.
- Adapter authors must normalize provider usage and finish metadata into the Doxa contract.
- Detailed content debugging remains an explicit, separately governed capability rather than a
  convenient default.

## Required implementation proof

1. Model, tool, critic, and retry observations expose stable typed metadata and trace relationships.
2. Available input, output, cached, and reasoning token counts are normalized without inventing
   data.
3. Prompts, completions, SMS bodies, phone numbers, tool payloads, and customer PII are absent by
   default from observations, telemetry, database rows, and UI JSON.
4. AI adapter failure and observation failure cannot alter application outcomes.

## References

- [AI observation specification](../specifications/ai-observations.md)
- [Theoria](0025-first-party-theoria-debugger.md)
- [Distributed tracing](0030-standards-correct-distributed-tracing.md)
