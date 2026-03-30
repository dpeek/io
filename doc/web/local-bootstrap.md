# Localhost Bootstrap Contract

## Purpose

This doc defines the localhost-only instant-onboarding contract for the `web`
package. The goal is one short-lived local bootstrap credential that becomes a
normal Better Auth browser session, then hands off to the existing
`GET /api/bootstrap` and `POST /api/access/activate` flow instead of creating a
second permanent auth model.

The typed proof anchor for this contract lives in
[`../../lib/app/src/web/lib/local-bootstrap.ts`](../../lib/app/src/web/lib/local-bootstrap.ts)
with coverage in
[`../../lib/app/src/web/lib/local-bootstrap.test.ts`](../../lib/app/src/web/lib/local-bootstrap.test.ts).
The Worker route implementation now lives in
[`../../lib/app/src/web/worker/index.ts`](../../lib/app/src/web/worker/index.ts)
with Worker coverage in
[`../../lib/app/src/web/worker/index.test.ts`](../../lib/app/src/web/worker/index.test.ts).

## Default Local First Run

For local development, this is the default first-run path:

1. run `io start`
2. open the local web shell on its loopback origin
3. click `Start locally`
4. let the browser exchange one localhost-only bootstrap credential for a
   normal Better Auth session
5. let the existing bootstrap, optional first-operator bootstrap, and
   activation flow finish before graph-backed routes mount

That means local instant onboarding is not a second auth mode layered beside
Better Auth. It is a short local bridge into the same browser session model the
rest of the app uses. After the click succeeds, the browser is just running on
the normal Better Auth cookie plus the existing `GET /api/bootstrap` and
`POST /api/access/activate` contract.

Use the email sign-in or create-account form instead when you want to exercise
the more production-like auth path locally. `Start locally` exists so a fresh
checkout can get to a real local session and writable graph quickly without
manual approval or setup choreography.

## Worker Route Contract

The shipped Worker surface exposes two localhost-only routes:

- `POST /api/local-bootstrap/issue`: validates that the request origin exactly
  matches the configured local Better Auth base URL, issues one
  `LocalhostBootstrapCredential`, and persists its one-time redemption record in
  the auth-store verification table
- `POST /api/local-bootstrap/redeem`: requires a same-origin browser request,
  atomically consumes the issued credential, then creates or reuses the
  deterministic synthetic Better Auth user/session and returns a normal browser
  session cookie

Browser callers should treat the returned credential as opaque, redeem it over
the dedicated Worker route, then re-read `GET /api/bootstrap` to enter the
existing signed-in or admission-gated flow.

The shipped browser shell now exposes those same seams behind one explicit
signed-out `Start locally` action. On a localhost origin, that action redeems
the deterministic synthetic local identity into a normal Better Auth session.
It then reuses the existing principal bootstrap, optional
`bootstrap-operator-access` command, and `POST /api/access/activate` flow to
reach a writable graph session only when the outcome is unambiguous. Conflicts
or denials still surface as explicit errors instead of silent fallback.

The current end-to-end proof in
[`../../lib/app/src/web/worker/index.test.ts`](../../lib/app/src/web/worker/index.test.ts)
now covers the full browser-helper-to-worker path for:

- the happy path from `Start locally` to a writable graph session
- expired credential rejection
- replay rejection
- non-local browser denial
- ambiguous local admission failures that must stay explicit

## Localhost Bootstrap Credential

The Worker and browser share one credential contract:
`LocalhostBootstrapCredential`.

Stable fields:

- `kind = "localhost-bootstrap"`
- `availability = "localhost-only"`
- `token`: opaque one-time credential in the issued
  `io_local_bootstrap_<64 lowercase hex chars>` format
- `issuedAt`: ISO-8601 timestamp for issuance time
- `expiresAt`: ISO-8601 timestamp no later than 5 minutes after `issuedAt`
- `redeemOrigin`: exact local origin that may redeem the credential. Allowed
  hosts are `localhost`, `*.localhost`, `127.0.0.1`, and `[::1]`
- `oneTimeUse = true`
- `syntheticIdentity`: deterministic local identity payload described below

Operational rules:

- the browser treats `token` as opaque and does not infer identity from it
- the credential is created only for a local origin and is never valid on a
  deployed or remote hostname
- redemption is same-origin only and must terminate in a normal Better Auth
  session cookie before the browser re-reads `GET /api/bootstrap`
- the credential is burned on the first accepted redemption attempt; retries
  must request a fresh credential instead of replaying the old one

## Synthetic Local Identity

The credential maps onto one deterministic local identity:
`LocalhostSyntheticIdentity`.

Stable fields:

- `localIdentityId`: canonical `local:<slug>` key for the local onboarding
  subject
- `email`: deterministic synthetic Better Auth email derived from that id as
  `local+<slug>@localhost.invalid`
- `displayName`: non-empty local display label such as `Local Operator`

This identity is only the local bootstrap bridge. The redeem path creates or
reuses the Better Auth user/session represented by that synthetic email, then
the existing Branch 2 auth flow takes over:

1. the Worker creates or reuses the Better Auth user/session for the synthetic
   local identity
2. the browser receives a normal Better Auth session cookie
3. `GET /api/bootstrap` resolves through the existing Better Auth
   session-to-principal projection
4. `POST /api/access/activate` continues to own the graph-role activation step

That means the long-lived browser auth state stays the same as every other
Better Auth session. The synthetic local identity is only the local bootstrap
input, not a second durable browser auth model.

## Guardrails And Failure Behavior

Local-only guardrails:

- issue and redeem are available only when the app origin is loopback or
  localhost-based
- the contract must fail closed when the configured Worker base URL is remote
  or when the request origin does not match the issued `redeemOrigin`
- the synthetic email domain stays `@localhost.invalid` so the flow never
  pretends to be a deliverable production email identity

Failure behavior:

- invalid, expired, or already-spent credentials do not create a session and
  leave the browser in the existing signed-out shell state
- local bootstrap failures do not invent a new bootstrap payload state; after a
  failed redemption the browser is still just `signed-out` until a normal
  session exists
- local bootstrap success must still end in the normal `ready` bootstrap state
  returned by `GET /api/bootstrap`
- if the local synthetic identity still cannot reach one unique safe writable
  path, the shell surfaces the command or activation error instead of
  guessing between admission outcomes

## Current Scope

The Worker owns the local issue and redeem routes plus the one-time auth-store
backing record that enforces expiry and replay rejection. The browser now owns
the localhost-only orchestration that:

- exposes the deterministic synthetic local session behind the signed-out
  `Start locally` action
- retries the existing principal bootstrap after that session exists
- runs the existing writable-access activation step when the admitted path is
  already unambiguous
- falls back to the shipped `bootstrap-operator-access` command only when the
  synthetic localhost identity is still unwritable and the flow can safely
  choose that first-operator outcome

The broader local happy path still builds on the existing bootstrap,
admission, and explicit access-activation seams rather than replacing them.
