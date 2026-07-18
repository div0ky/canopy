---
'@doxajs/compiler': patch
'@doxajs/core': patch
'@doxajs/gnosis': patch
'@doxajs/introspection': patch
'@doxajs/manifest': patch
'@doxajs/praxis': patch
'@doxajs/runtime': patch
---

Implement concrete `Feature.provides` exports without widening service scope, and add one
application-wide, execution-cached `PermissionSource` that maps application-owned permission facts
to stable Doxa abilities before optional resource-policy narrowing. Expose the compiled source
through Praxis and Gnosis, add `make:permission-source` and `make:service --provide`, fail closed on
invalid catalogs and results, and keep loaded permissions out of propagated execution context.
