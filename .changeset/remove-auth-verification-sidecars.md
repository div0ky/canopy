---
'@doxajs/auth-postgres': patch
'@doxajs/compiler': patch
'@doxajs/core': patch
'@doxajs/manifest': patch
'@doxajs/praxis': patch
---

Remove alpha authentication sidecars. Doxa-owned identities retain their native email-verification
column; external mappings must explicitly map a verification column or compile with verification
unsupported. This is an auth-postgres alpha schema re-baseline: recreate prerelease databases, or
manually retire orphan mapped-auth sidecar tables before upgrade.
