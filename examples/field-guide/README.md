# Canopy Field Guide

Field Guide is Canopy's external browser-consumer fixture. It is a Next.js App Router application
using Tailwind CSS and shadcn/ui. It deliberately imports no Canopy runtime packages: every
interaction crosses the public HTTP boundary exactly as a separately deployed frontend would.

## Run it

Start Canopy from the workspace root, then start Field Guide in another terminal:

```bash
pnpm dev
pnpm dev:field-guide
```

Open `http://127.0.0.1:3001`. The Next server forwards `/api/canopy/*` to `CANOPY_API_URL`, which
defaults to `http://127.0.0.1:3000`. Copy `.env.example` to `.env.local` only when that backend URL
needs to change.

## What it proves

- `GET /health` and `GET /hello/:name` through a typed frontend client.
- Email/password registration and login.
- Browser cookie propagation and `GET /auth/me` session resolution.
- Logout and cookie expiry.
- One-time opaque bearer-token issuance.
- A default-deny protected counter mutation.
- Transactional model persistence followed by durable job dispatch.
- Stable Canopy error normalization without importing backend implementation types.

The same-origin Next route is an HTTP transport adapter, not a second application API. It forwards
method, query, body, browser cookie, origin, authorization, content type, and user agent while
preserving Canopy's status, headers, and response body. In production, the trusted frontend origin
must also be declared by the Canopy authentication provider.

## Design and checks

The accepted visual concept is [field-guide-concept.png](docs/design/field-guide-concept.png). Its
editorial field-notebook direction is implemented with semantic shadcn/ui components and Tailwind
tokens; all controls and application text remain code-native.

```bash
pnpm check:field-guide
```

The root MVP audit runs this check and enforces the external-consumer dependency boundary.
