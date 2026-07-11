# Deployment

Canopy generates one immutable multi-stage image and specializes it by command:

| Role       | Command         | Scaling                           |
| ---------- | --------------- | --------------------------------- |
| Web        | `arbor serve`   | Horizontal                        |
| Background | `arbor work`    | Horizontal; workers and schedules |
| Migration  | `arbor migrate` | One release job                   |

The release order is:

1. Build and publish one image digest.
2. Run `arbor migrate` once from that digest.
3. Promote web and background services from the same digest.
4. Let old replicas drain under Canopy lifecycle deadlines.

Runtime roles require prebuilt `dist/` and `.canopy/` artifacts. They do not compile application
source. The production dependency closure omits TypeScript, the compiler, Drizzle Studio, and
development-only Undergrowth tooling unless the application explicitly installs a runtime adapter.

See the normative
[container deployment specification](../../manifesto/specifications/container-deployment.md).
