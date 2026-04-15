---
name: Graphle SQLite bootstrap
description: "Local graphle.sqlite bootstrap, persisted-authority storage, and health ownership for @dpeek/graphle-sqlite."
last_updated: 2026-04-15
---

# Graphle SQLite Bootstrap

## Read This When

- you are changing how `graphle.sqlite` is opened or initialized
- you need the boundary between local file creation and graph authority
  persistence rows
- you are changing `/api/health` database status in `@dpeek/graphle-local`

## Current Contract

`@dpeek/graphle-sqlite` opens or creates a SQLite database at an absolute path,
ensures `graphle_meta` exists, stores the current schema version, creates the
shared persisted-authority tables, and exposes a health summary.

The package uses Bun's `bun:sqlite` API and is server-only.

## Persisted Authority Rows

The adapter implements `PersistedAuthoritativeGraphStorage` from
`@dpeek/graphle-authority`.

- `graphle_authority_state` stores one current versioned authority state JSON
  blob per authority id
- `graphle_authority_commit` stores accepted transaction rows keyed by
  authority id and transaction id
- `load()` returns the persisted snapshot, retained write history, retained
  records, and startup recovery diagnostics
- `commit()` atomically rewrites the state blob and appends the accepted
  transaction row
- `persist()` atomically rewrites the state blob and retained commit window

The SQL layout is conservative on purpose. Consumers see only the shared
authority storage contract, not route-local or site-specific tables.

## Boundary

This package does not define site content tables, HTTP routes, local auth,
browser startup, Cloudflare D1, or Durable Object storage.

Consumers should pass absolute paths and close returned handles when their server
shuts down.
