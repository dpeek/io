# Plans

- [Personal site MVP](/Users/dpeek/code/graphle/pdr/personal-site-mvp/spec.md):
  ship the first end-to-end Graphle product slice with `bunx @dpeek/graphle dev`,
  cwd-local `graphle.sqlite`, a reusable shell, a site module, Cloudflare deploy,
  and local/remote graph sync.
- [Personal site MVP phase 1](/Users/dpeek/code/graphle/pdr/personal-site-mvp/phase-1-local-dev.md):
  implemented the local `graphle dev` spine with `.env`, `graphle.sqlite`, a Bun
  server, `/api/init`, signed local admin cookies, placeholder site rendering,
  and focused tests.
- [Personal site MVP phase 2](/Users/dpeek/code/graphle/pdr/personal-site-mvp/phase-2-site-graph.md):
  plan the minimal core and durable site graph substrate: site schema, SQLite
  persisted-authority storage, first-run seed content, and local runtime graph
  bootstrap.
- [Dedicated auth routes](/Users/dpeek/code/graphle/pdr/dedicated-auth-routes.md):
  move inline auth into dedicated sign-in/sign-up routes with TanStack
  Router route guards and Better Auth-aligned session context.
- [Entity surface](/Users/dpeek/code/graphle/pdr/entity-surface.md): formalize the app-owned editable entity surface and define its relationship to `RecordSurfaceSpec`.
