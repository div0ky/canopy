# Next.js Field Guide Frontend Slice

- **Status:** Implemented proof
- **Implemented:** 2026-07-10
- **Depends on:** [Hono HTTP](hono-http-vertical-slice.md),
  [authentication completion](authentication-completion-vertical-slice.md), and
  [queue workers](pg-boss-queue-worker-vertical-slice.md)

## Outcome

Canopy now has a separately composed browser fixture under `examples/field-guide`. It uses Next.js
App Router, Tailwind CSS, and shadcn/ui without importing Canopy, Hono, Drizzle, pg-boss, or auth
adapter types. That makes the fixture a real external consumer rather than another view inside the
framework runtime.

```text
Browser
  → same-origin /api/canopy transport in Next.js
  → public Canopy HTTP contract
  → first-party cookie or bearer authentication
  → admitted execution, policy, action, model transaction
  → journal/outbox and queued work
```

The Next route preserves the relevant HTTP contract while avoiding browser CORS and cookie-domain
coupling in local development. Canopy still owns origin validation; the reference authentication
provider explicitly trusts the Field Guide development origins.

## Proven workflows

1. Health and parameterized public route calls.
2. Registration followed by password login.
3. Opaque session cookie forwarding and current-identity resolution.
4. Session logout.
5. One-time constrained bearer-token creation.
6. A default-deny protected counter action.
7. Model persistence, reactive behavior, and a durable queued job from that action.
8. Normalized frontend errors without backend implementation leakage.

The visual implementation follows the checked-in Field Guide concept and uses shadcn/ui primitives
for navigation, cards, forms, status, alerts, feedback, and responsive behavior. The full interface
remains code-native and accessible.

## Acceptance evidence

- Field Guide ESLint and production Next build are part of `pnpm audit:mvp`.
- The root boundary audit scans `.ts` and `.tsx` in the frontend and rejects private engine imports.
- A first-party fixture test verifies the workspace stack, proxy contract, endpoints, and absence of
  Canopy package imports.
- Browser testing exercises hello, registration/login, cookie identity, bearer-token issuance,
  protected counter mutation, and resulting job activity with no console errors.
- Desktop and mobile layouts are inspected against the accepted visual direction.
