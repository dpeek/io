Status: Proposed
Last Updated: 2026-04-15

# Personal site MVP

## Must Read

- `../../doc/index.md`
- `../../doc/vision.md`
- `../../lib/graphle/package.json`
- `../../lib/graphle-cli/src/cli/index.ts`
- `../../lib/graphle-cli/doc/command-surfaces.md`
- `../../lib/graphle-kernel/doc/runtime-stack.md`
- `../../lib/graphle-authority/doc/persistence.md`
- `../../lib/graphle-authority/src/server.ts`
- `../../lib/graphle-bootstrap/doc/core-schema-requirements.md`
- `../../lib/graphle-module-core/src/core.ts`
- `../../lib/graphle-module-core/doc/core-namespace.md`
- `../../lib/graphle-app/doc/web-overview.md`
- `../../lib/graphle-app/doc/auth-store.md`
- `../../lib/graphle-app/doc/authority-storage.md`
- `../../lib/graphle-app/src/web/lib/authority.ts`
- `../../lib/graphle-app/src/web/worker/index.ts`

## Requirements

Ship the smallest end-to-end Graphle product slice: a user can run one command
from an empty directory, author a personal website locally, and deploy that
website to Cloudflare from the web UI.

The first concrete target is replacing the current `https://dpeek.com` shape:

- a home page at `/`
- markdown-authored pages
- markdown-authored posts
- automatic public post routes at `/posts/:slug`
- a simple authoring UI for pages and posts
- local graph state that survives restarts
- remote graph state on Cloudflare after deploy
- sync between the local graph and the remote graph

The first public command is:

```sh
bunx @dpeek/graphle dev
```

The command must:

- create project-local state in the current working directory
- create or reuse `graphle.sqlite`
- create or reuse `.env`
- generate local secrets automatically on first run
- launch a local web server
- open the browser through a one-time init flow and land on `/`
- complete first-run local admin auth without manual account setup
- leave the user with editable durable website records

The MVP must not depend on `@dpeek/graphle-app` for the product path. The
current app is allowed to remain in the repo while the new path ships beside it.

The MVP must create new package boundaries instead of growing the existing app:

- `@dpeek/graphle`: public package and `graphle` binary entrypoint for `bunx`
- `@dpeek/graphle-local`: local Bun server, cwd project layout, first-run
  bootstrap, local auth, and local graph host wiring
- `@dpeek/graphle-sqlite`: SQLite-backed persisted authority storage adapter
  for `graphle.sqlite`
- `@dpeek/graphle-web-ui`: browser UI kit and presentation primitives,
  replacing or narrowing the current `@dpeek/graphle-web` boundary
- `@dpeek/graphle-web-shell`: lightweight reusable browser shell runtime that is
  not tied to personal websites
- `@dpeek/graphle-module-site`: site schema, module manifest, routing metadata,
  and site-specific query/read contracts
- `@dpeek/graphle-site-web`: personal-site authoring and public preview surfaces
  plus the assembled browser bundle that mounts those surfaces inside the
  generic web shell
- `@dpeek/graphle-deploy-cloudflare`: Cloudflare provisioning, deploy, remote
  graph bootstrap, and remote endpoint discovery

Package names may change during phase planning, but the ownership split must
remain: shell, site module, local runtime, SQLite storage, and Cloudflare deploy
are separate concerns.

Phase PDRs are created just in time. Do not write detailed implementation plans
for every phase up front; keep this spec as the cross-phase contract and create
the next phase plan only when that phase is ready to execute.

## Architecture

### Product path

The new product path is:

1. `@dpeek/graphle` exposes the user-facing `graphle` bin.
2. `graphle dev` delegates to the local runtime.
3. `@dpeek/graphle-local` resolves the cwd project, creates `.env`, creates
   `graphle.sqlite`, starts the local HTTP server, and opens the browser.
4. The server mounts the generic shell and the site web surfaces.
5. The local authority uses core bootstrap plus the site module only.
6. The browser authoring surface writes page and post records through graph
   transactions.
7. The public preview route renders from the same local graph.
8. Deploy provisions Cloudflare resources and pushes the local graph baseline to
   the remote authority.
9. Sync keeps local and remote graph state aligned after deploy.

### Local project layout

The default cwd layout is intentionally small:

```text
.env
graphle.sqlite
```

Optional files may appear later, but the MVP should not scaffold a source app
unless the user explicitly asks for it. A later `graphle eject` or
`graphle create --source` flow can expose hackable source templates.

### Auth model

Better Auth is not part of this MVP path.

Local auth is a simple signed-cookie model backed by generated secrets in
`.env`. First run may open a one-time bootstrap URL that sets an HttpOnly local
admin cookie. The persisted graph does not need principal, admission, share, or
capability records for the first milestone.

Remote deploy may start with one generated remote admin secret and a matching
signed-cookie flow. Rich identity, sharing, and provider auth are future work.

### Graph model

The MVP graph is:

- minimal core bootstrap definitions
- `site` module definitions
- website content records
- deploy/sync metadata only when required

The site module owns the website schema:

- `site:page`
  - `title`
  - `path`
  - `body`
  - `status`
  - `updatedAt`
- `site:post`
  - `title`
  - `slug`
  - `body`
  - `excerpt`
  - `publishedAt`
  - `status`
  - `updatedAt`

The initial routing contract is:

- `site:page.path === "/"` renders the home page
- other pages render by exact path
- published posts render at `/posts/:slug`
- draft records are visible in authoring and local preview only

### Web UI kit and web shell

`@dpeek/graphle-web-ui` owns browser presentation primitives. It may be a rename
or replacement for the current `@dpeek/graphle-web` package. It should stay
runtime-agnostic and must not import graph runtime, local server, Cloudflare
deploy, shell, or site packages.

It owns:

- UI kit components
- layout primitives
- app frame primitives
- sidebar/header/navigation primitives
- empty, loading, error, and status components
- browser-safe markdown and form primitives when they are not graph-specific

`@dpeek/graphle-web-shell` is a reusable browser shell runtime for future
Graphle web use cases. It must not import site schema or assume a website
product.

It owns generic browser shell composition:

- app frame composition using `@dpeek/graphle-web-ui`
- navigation slots
- command/action slots
- status surfaces for local/remote/sync/auth
- extension registration for feature areas
- shared loading/error/empty states
- shared graph host context

Site-specific pages, copy, routing, and editors live in
`@dpeek/graphle-site-web`.

Non-web shells should use their own package names later, such as
`@dpeek/graphle-tui-shell`. They should not depend on browser UI packages.

### Packaged browser app and local server

`bunx @dpeek/graphle dev` must not require a user-project Vite build or a
scaffolded source tree. The default command runs a packaged local server and
serves prebuilt browser assets published to npm.

The package roles are:

- `@dpeek/graphle-web-shell` exports shell runtime contracts and React shell
  composition helpers. It is a library, not necessarily the concrete browser
  app bundle served to users.
- `@dpeek/graphle-site-web` assembles the personal-site browser app by importing
  `@dpeek/graphle-web-shell`, `@dpeek/graphle-web-ui`, and the site feature
  surfaces. Its package build runs Vite/TanStack Router and publishes
  `dist/client/**` in npm.
- `@dpeek/graphle-local` runs the Bun HTTP server. It serves the packaged
  `@dpeek/graphle-site-web` client assets and owns local API routes, local auth,
  graph transactions, public site rendering, and deploy/sync endpoints.
- `@dpeek/graphle` exposes the compiled `graphle` bin and delegates `dev` to
  `@dpeek/graphle-local`.

Default runtime route ownership:

- `/api/*`: the only API namespace, used for local graph operations, auth,
  deploy, and sync
- `/api/init`: first-run and bootstrap endpoint that may set an HttpOnly admin
  cookie and redirect back to the site
- `/`: public home page rendered from the graph
- `/posts/:slug`: public post route rendered from the graph
- other public page paths: exact `site:page.path` matches

All non-API routes belong to the user's website. The browser app renders the
public site and reveals inline authoring controls when the request has a valid
admin session. `graphle dev` should open a one-time `/api/init?...` URL on first
run when needed; that endpoint establishes the local admin session and redirects
to `/`. On later runs, `graphle dev` can open `/` directly.

The first-run init contract should be boring and explicit:

- `GET /api/init?token=<one-time-token>` may set the local admin cookie and
  redirect to `/`
- `POST /api/init` may be added later if the browser needs a JSON bootstrap
  exchange
- `/api/init` must be one-time or idempotently safe after initialization
- deployed graphs use the same `/api/*` namespace and inline-authoring model,
  with remote admin auth replacing the local bootstrap token

TanStack Router can be used in the packaged browser app, but route generation
must happen before publishing the package. The default user command should load
prebuilt route artifacts from npm, not generate route trees inside the user's
project directory. Future feature extensibility should prefer explicit feature
manifests and code-defined route contributions over runtime file-route
generation from user folders.

Contributor development may still use Vite dev/HMR inside this repo. That is a
repo development mode, not the default `bunx` product path.

### Core simplification

`@dpeek/graphle-module-core` must be stripped for the MVP path to:

- bootstrap anchors: `node`, `type`, `predicate`, `enum`, `cardinality`
- basic scalars: `string`, `number`, `boolean`, `date`, `json`, `markdown`,
  `slug`, `url`
- only the additional records needed by the site module, if any

Identity, admission, share, capability grants, saved queries, saved views,
secret handles, workflow records, and structured-value families must not be on
the MVP boot path.

Bootstrap should not require icons or SVG records for a site graph. If icon
support remains useful for richer shells, it should be optional or moved to a
separate UI/icon module.

### Relationship to existing app

`@dpeek/graphle-app` remains a proof package, not the MVP host. Do not move its
Better Auth, workflow, installed-module, retained-projection, or generic query
surface complexity into the new packages.

Code may be copied only when it can be reduced into a clean package boundary.
Prefer deleting or bypassing app-owned abstractions over preserving
compatibility with them.

## Rules

- New product work starts outside `@dpeek/graphle-app`.
- Do not use Better Auth in the personal-site MVP path.
- Do not scaffold a source project for the default `graphle dev` flow.
- Keep the default local state to `.env` plus `graphle.sqlite`.
- Serve prebuilt browser assets from npm for the default `graphle dev` path.
- Keep Vite/TanStack route generation in package build or repo-development
  workflows, not in the user's cwd at runtime.
- Reserve `/api/*` as the single API namespace.
- Do not introduce nested product namespaces such as `/_graphle/api/*`.
- Keep authoring inline on site routes when an admin session is present instead
  of creating a separate authoring route namespace.
- Keep the shell generic and site-agnostic.
- Keep browser UI primitives in `@dpeek/graphle-web-ui`; keep browser shell
  runtime and feature composition in `@dpeek/graphle-web-shell`.
- Keep site schema and site UI in separate packages.
- Keep Cloudflare deploy code out of the local runtime package.
- Keep SQLite storage as an authority storage adapter, not ad hoc route state.
- Keep docs package-owned as new packages appear.
- Every new package must include a README and package-local docs for its current
  ownership boundary before the phase is complete.
- Backwards compatibility with the current app proof is not a concern.
- Every phase must identify what it removes, bypasses, or refuses to carry
  forward from the current app.

## Phases

### Phase 0: Spec and package map

Goal: establish this spec as the source of truth and make the package split
explicit before implementation begins.

Deliverables:

- this spec
- updated `pdr/README.md`
- phase order and non-goals agreed enough to start Phase 1

Verification:

- `turbo build`
- `turbo check`

### Phase 1: User-facing CLI and local project bootstrap

Goal: `bunx @dpeek/graphle dev` starts a local server from an empty directory
and writes stable local project state.

Expected PDR:

- `pdr/personal-site-mvp/phase-1-local-dev.md`

Primary packages:

- `@dpeek/graphle`
- `@dpeek/graphle-local`
- `@dpeek/graphle-sqlite`
- `@dpeek/graphle-cli` only if the existing dispatcher remains useful

Tasks:

- make `@dpeek/graphle` the public binary package
- add the `dev` command
- define the cwd project layout
- generate `.env` secrets
- create/open `graphle.sqlite`
- start the local HTTP server
- serve packaged browser assets without launching Vite in the user's project
- open the browser through `/api/init` when the local admin cookie is missing,
  otherwise open `/`
- implement a one-time first-run local admin bootstrap
- document the local runtime package

Success criteria:

- running the command in a new temp directory creates `.env` and
  `graphle.sqlite`
- a browser opens to `/` with an admin session established through `/api/init`
- public `/` remains available for the rendered website
- restarting reuses the same project state
- no Better Auth or `AUTH_DB` path is involved

### Phase 2: Minimal core and site schema

Goal: the local authority boots only minimal core plus the site module.

Expected PDR:

- `pdr/personal-site-mvp/phase-2-site-graph.md`

Primary packages:

- `@dpeek/graphle-module-core`
- `@dpeek/graphle-module-site`
- `@dpeek/graphle-bootstrap`
- `@dpeek/graphle-sqlite`

Tasks:

- define the minimal core contract for the MVP boot path
- make icon/SVG bootstrap optional or move it out of the required core schema
- add `site:page` and `site:post`
- add stable id-map generation/check workflow for the site module
- seed a default home page and example post on first run
- verify writes persist in `graphle.sqlite`

Success criteria:

- a fresh graph contains only bootstrap/core/site records plus seed content
- the site graph can be read and written through the typed graph client
- no workflow, identity, admission, saved-query, or installed-module records are
  required for local boot

### Phase 3: Lightweight shell

Goal: create a reusable shell that can host site authoring now and other Graphle
use cases later.

Expected PDR:

- `pdr/personal-site-mvp/phase-3-shell.md`

Primary packages:

- `@dpeek/graphle-web-ui`
- `@dpeek/graphle-web-shell`
- `@dpeek/graphle-local`
- `@dpeek/graphle-site-web`

Tasks:

- split or rename the current `@dpeek/graphle-web` boundary into the
  `@dpeek/graphle-web-ui` ownership model
- build the generic browser shell frame and host context
- define feature registration/slot contracts
- expose auth, graph, sync, and deploy status in generic shell terms
- make the shell library usable by assembled browser apps without owning
  site-specific routes
- avoid any site imports from the web shell package
- mount the shell from the local server

Success criteria:

- the web shell renders without a site feature installed
- the site feature can register navigation and pages
- web UI and web shell package docs explain what belongs in each package

### Phase 4: Inline site authoring and preview

Goal: render public site routes from the graph and reveal inline authoring
controls on those same routes when a valid admin session is present.

Expected PDR:

- `pdr/personal-site-mvp/phase-4-site-web.md`

Primary packages:

- `@dpeek/graphle-site-web`
- `@dpeek/graphle-module-site`
- `@dpeek/graphle-web-shell`
- `@dpeek/graphle-web-ui`
- `@dpeek/graphle-local`

Tasks:

- add page list, page editor, post list, and post editor
- build and publish the assembled site browser app bundle
- add markdown editing and preview
- render public routes for pages and posts
- expose inline edit, create, publish, and preview controls for authenticated
  local admins
- add status handling for draft and published records
- seed or import enough content to match the current `dpeek.com` shape

Success criteria:

- home page can be rendered publicly and edited inline at `/` when logged in
- a post can be created, edited, published, and rendered at `/posts/:slug`
- the authoring UI survives server restart because data comes from
  `graphle.sqlite`
- the public renderer does not require admin auth for published content

### Phase 5: Cloudflare deploy

Goal: deploy the local site graph to Cloudflare from the web shell.

Expected PDR:

- `pdr/personal-site-mvp/phase-5-cloudflare-deploy.md`

Primary packages:

- `@dpeek/graphle-deploy-cloudflare`
- `@dpeek/graphle-local`
- `@dpeek/graphle-web-shell`
- remote Worker package or deploy bundle owned by the deploy package

Tasks:

- define required Cloudflare credential input
- provision or update Worker and Durable Object resources
- publish the public site renderer
- push the local graph baseline to the remote authority
- store remote endpoint metadata locally
- expose deploy status and errors in the shell

Success criteria:

- a user can deploy from the web UI
- the deployed Worker serves the home page and post routes from remote graph
  state
- deploy can be re-run without creating duplicate resources

### Phase 6: Local/remote sync

Goal: keep local and remote graph state aligned after deploy.

Expected PDR:

- `pdr/personal-site-mvp/phase-6-remote-sync.md`

Primary packages:

- `@dpeek/graphle-local`
- `@dpeek/graphle-deploy-cloudflare`
- `@dpeek/graphle-sync`
- `@dpeek/graphle-client`
- `@dpeek/graphle-web-shell`

Tasks:

- define local-to-remote push behavior
- define remote-to-local pull behavior
- expose sync status in the shell
- handle remote auth using generated deploy/admin secrets
- define first MVP conflict behavior

Success criteria:

- local edits can push to the deployed graph
- remote graph state can be pulled into the local graph
- sync status is visible and actionable in the shell
- conflict behavior is explicit, even if conservative

### Phase 7: Cleanup and deprecation

Goal: remove or quarantine complexity that the MVP has replaced.

Expected PDR:

- `pdr/personal-site-mvp/phase-7-cleanup.md`

Primary packages:

- `@dpeek/graphle-module-core`
- `@dpeek/graphle-app`
- docs under `doc/` and `lib/*/doc/`

Tasks:

- finish core namespace trimming
- move non-MVP core records to later packages or mark them retired
- update docs to make the new product path canonical
- mark `@dpeek/graphle-app` as legacy/proof if it remains
- delete stale PDRs that describe Better Auth-first product direction when no
  longer relevant

Success criteria:

- the docs index points users to the new product path
- the package READMEs explain current ownership
- the MVP boot path is visibly smaller than the old app proof

## Success Criteria

- `bunx @dpeek/graphle dev` works from a clean directory.
- The command creates `.env` and `graphle.sqlite`.
- The browser opens to `/`; first run uses `/api/init` to establish an admin
  session before redirecting there.
- First-run local admin auth is automatic and does not use Better Auth.
- The shell is generic and site-agnostic.
- The site feature can create, edit, publish, and render pages and posts with
  inline authoring controls when logged in.
- The current `dpeek.com` content shape can be represented with the MVP schema.
- Cloudflare deploy can be initiated from the web shell.
- The deployed site serves public pages and posts from the remote graph.
- Local and remote graph state can sync after deploy.
- The MVP path does not import or boot `@dpeek/graphle-app`.
- `@dpeek/graphle-module-core` is reduced on the MVP path to basic scalars and
  bootstrap contracts.
- Package docs and `doc/index.md` stay current as package ownership changes.
- `turbo build` and `turbo check` pass after each phase.

## Non-Goals

- full hosted control plane
- multi-user auth
- OAuth/provider auth
- Better Auth migration work
- sharing and federation
- image upload pipeline
- asset blob storage
- rich theme builder
- static export
- source scaffold by default
- arbitrary custom schema authoring in the first-run UI
- preserving the current `@dpeek/graphle-app` behavior

## Learnings

- The existing graph, bootstrap, persisted authority, sync, and Worker proof are
  valuable, but the first product path is obscured by Better Auth, workflow,
  installed-module, retained-projection, and generic query-surface proofs.
- `@dpeek/graphle-app` should not be the starting point for this MVP.
- The first shippable slice should prove a personal website because it forces
  real local state, real authoring, real public rendering, and real deploy
  without requiring the whole personal graph vision.
- The reusable shell needs to be extracted as a small host, not another
  product-specific app.
- Core must become boring again before the product can feel simple.
