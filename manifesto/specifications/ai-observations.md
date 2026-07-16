# AI Observations

The privacy-safe AI observation contract is defined by
[decision 0032](../decisions/0032-privacy-safe-ai-observations.md).

## Vocabulary

The initial kinds are `ai.operation`, `ai.tool`, `ai.critic`, and `ai.retry`. Records may contain:

- a stable operation, provider, model, tool, or critic ID;
- status, latency, attempt and retry count, finish reason, and cache status;
- input, output, cached, and reasoning token counts when the provider supplies them;
- a bounded structured critic verdict or safe outcome classification and stable reason code;
- normal execution, trace, actor, tenant, role, and transport provenance.

Missing provider data remains absent. Doxa never estimates token counts and reports them as
measured.

## Privacy contract

The default schema has no fields for prompt bodies, completions, tool arguments or results, message
or SMS content, phone numbers, names, addresses, or customer identifiers. Adapters normalize only
the operational metadata above. Arbitrary attributes cross the normal sanitizer and size bounds
before they reach any recorder or telemetry sink.

Theoria inspectors may show the safe metadata. They must not provide a hidden raw-payload endpoint.

## Timing and causality

AI model, tool, and critic invocations are instrumented child spans. A retry is linked to its prior
attempt and shares the broader business correlation while retaining its own span. Tool fan-out uses
span links where appropriate.
