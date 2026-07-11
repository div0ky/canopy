# Security Policy

## Supported versions

Canopy is currently pre-1.0. Security fixes are provided for the latest published prerelease only.
No release should be treated as production-stable until the independent review required by the
[security model](manifesto/security.md) is complete.

## Reporting a vulnerability

Do not open a public issue. Use GitHub private vulnerability reporting for the Canopy repository.
Include the affected version or commit, impact, reproduction, and any known mitigation. Reports will
be acknowledged within three business days and triaged as quickly as practical.

Maintainers will coordinate disclosure, remediation, release timing, and credit with the reporter.
Please do not publish details before a fix and disclosure plan are agreed.

## Scope

Authentication, authorization, tenant isolation, credential handling, HTTP admission, manifest
integrity, migrations, queues, schedules, provider webhooks, logging/redaction, generated
deployment, and supply-chain behavior are in scope.

Operational questions and ordinary bugs belong in GitHub Discussions or Issues instead.
