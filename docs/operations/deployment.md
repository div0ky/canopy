# Deployment

Doxa generates one immutable multi-stage image and specializes it by command:

| Role       | Command        | Scaling                           |
| ---------- | -------------- | --------------------------------- |
| Web        | `doxa serve`   | Horizontal                        |
| Background | `doxa work`    | Horizontal; workers and schedules |
| Migration  | `doxa migrate` | One release job                   |

The release order is:

1. Build and publish one image digest.
2. Run `doxa migrate` once from that digest.
3. Promote web and background services from the same digest.
4. Let old replicas drain under Doxa lifecycle deadlines.

Runtime roles require prebuilt `dist/` and `.doxa/` artifacts. They do not compile application
source. The production dependency closure omits TypeScript, the compiler, Drizzle Studio, and
optional Theoria tooling unless the application explicitly installs its runtime adapter.

Production Theoria requires the public `production-diagnostics` application profile, explicit
enablement, bounded capture and retention, and protected operator access. It remains complementary
to the production OpenTelemetry, logging, metrics, alerting, and audit paths. See
[Observability, OpenTelemetry, and Theoria](../guides/observability.md).

See the normative
[container deployment specification](../../manifesto/specifications/container-deployment.md).
