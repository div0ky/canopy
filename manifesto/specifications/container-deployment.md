# Container Deployment

Doxa's default deployment unit is one precompiled immutable image. The image is run as a web role, a
combined background role, or a one-off migration job. The normative contract is accepted in
[decision 0026](../decisions/0026-one-image-role-based-container-deployment.md).

## Canonical workflow

```sh
docker build -t application .
docker run application doxa migrate
docker run -p 3000:3000 application doxa serve --host=0.0.0.0
docker run application doxa work
```

The image build runs `doxa build`. Runtime commands require the resulting `dist/` and `.doxa/`
artifacts. `doxa dev` is never a production entrypoint.

## Default roles

- **Web** owns HTTP admission and may scale horizontally.
- **Background** consumes queued work, flushes the outbox, and admits schedules. It may scale
  horizontally because schedule identity and reconciliation are distributed-safe.
- **Migration** applies forward-only migrations as a release step and exits.

Standalone `doxa schedule` is an advanced topology for deployments that need independent resource
allocation or fault isolation. When used, worker containers must disable schedule admission by using
the isolated command semantics defined by Praxis.

## Runtime environment

Configuration and secrets are injected at container runtime. The generated image sets
`NODE_ENV=production`, uses port `3000`, binds web traffic to `0.0.0.0`, runs as a non-root user,
and receives `SIGTERM` directly. Application configuration remains declared through Doxa config
classes; Docker does not create a second configuration system.

## Release ordering

1. Build and publish one image digest.
2. Run `doxa migrate` from that digest exactly once.
3. Promote web and background services using that same digest.
4. Let old replicas drain under Doxa lifecycle deadlines.

Automatic migrate-on-boot entrypoints are prohibited.
