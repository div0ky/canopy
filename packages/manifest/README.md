# `@doxajs/manifest`

The versioned, serializable, inert manifest contract shared by the Doxa compiler and runtime.
Ordinary applications should use `@doxajs/core` instead of importing this package.

Manifest formats fail closed when compiler and runtime compatibility do not match. The package has
no dependency on application code, runtime construction, or TypeScript compilation.

See the
[manifest architecture](https://github.com/div0ky/doxajs/blob/main/manifesto/architecture.md) for
the compatibility contract.
