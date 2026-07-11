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
development-only Theoria tooling unless the application explicitly installs a runtime adapter.

See the normative
[container deployment specification](../../manifesto/specifications/container-deployment.md).
