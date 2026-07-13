# Repository Settings

After the workflows reach `main`, configure a GitHub ruleset for the default branch:

- Require pull requests and one approving review.
- Dismiss stale approvals and require approval of the latest reviewable push.
- Require resolved conversations.
- Require `CI / Verify`, `Dependency review / dependency-review`, and CodeQL checks.
- Block force pushes and branch deletion.
- Require signed commits when every active maintainer can comply.
- Restrict workflow changes to CODEOWNERS review.

Enable the dependency graph, Dependabot alerts and security updates, secret scanning, push
protection, private vulnerability reporting, code scanning, and GitHub Discussions. Disable other
unused repository features instead of leaving unmaintained support surfaces visible.

## npm publication

1. Reserve the `@doxajs` npm organization and require two-factor authentication.
2. Bootstrap each public package once if npm requires an initial owner publication.
3. Configure `release.yml` as the trusted publisher for every package and restrict token-based
   publication afterward.
4. Protect the `npm` GitHub environment and require maintainer approval.
5. Publish prereleases under the tag configured by Changesets prerelease mode. The current release
   train uses `alpha`; do not introduce a parallel `next` channel unless a release decision changes
   `.changeset/pre.json`, upgrade guidance, and installation documentation together.
