---
name: App local bootstrap
description: "Current localhost-only instant-onboarding contract for the @io/app web shell."
last_updated: 2026-04-07
---

# App local bootstrap

## Read this when

- you are changing the localhost-only `Start locally` flow
- you need the local bootstrap credential contract
- you are debugging issue or redeem behavior in the Worker or browser shell

## Purpose

The localhost-only onboarding path uses one short-lived bootstrap credential to
become a normal Better Auth browser session, then hands off to the existing
`GET /api/bootstrap` and `POST /api/access/activate` flow instead of creating a
second permanent auth model.

## Default local first run

1. run `turbo dev`
2. open the local web shell
3. click `Start locally`
4. redeem one localhost-only bootstrap credential into a normal Better Auth
   session
5. finish the existing bootstrap and activation flow before graph-backed routes
   mount

## Worker route contract

Current localhost-only routes:

- `POST /api/local-bootstrap/issue`
- `POST /api/local-bootstrap/redeem`

Current rules:

- issue and redeem are available only on loopback or localhost origins
- the browser treats the returned token as opaque
- redemption is same-origin only
- the credential is burned on the first accepted redemption
- failures leave the shell in the existing signed-out state

## Shared credential shape

The Worker and browser share `LocalhostBootstrapCredential` with:

- one opaque token
- issue and expiry timestamps
- one exact redeem origin
- one-time-use semantics
- one deterministic synthetic local identity payload

The synthetic identity is only the bootstrap input. Long-lived browser auth
state still becomes an ordinary Better Auth session.

## Source anchors

- `../src/web/lib/local-bootstrap.ts`
- `../src/web/lib/local-bootstrap.test.ts`
- `../src/web/worker/index.ts`
- `../src/web/worker/index.test.ts`
- `../src/web/components/auth-shell.tsx`

## Related docs

- [`./web-overview.md`](./web-overview.md): current browser bootstrap and shell
  boundary
- [`./auth-store.md`](./auth-store.md): Better Auth store and Worker runtime
  wiring
