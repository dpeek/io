---
name: Graphle SQLite bootstrap
description: "Local graphle.sqlite bootstrap and health ownership for @dpeek/graphle-sqlite."
last_updated: 2026-04-15
---

# Graphle SQLite Bootstrap

## Read This When

- you are changing how `graphle.sqlite` is opened or initialized
- you need the boundary between local file creation and future graph authority
  persistence rows
- you are changing `/api/health` database status in `@dpeek/graphle-local`

## Current Contract

`@dpeek/graphle-sqlite` is intentionally small in phase 1. It opens or creates a
SQLite database at an absolute path, ensures a `graphle_meta` table exists, stores
the current schema version, and exposes a health summary.

The package uses Bun's `bun:sqlite` API and is server-only.

## Boundary

This package does not define site content tables, graph transaction storage, or a
persisted authority adapter yet. Those rows should land when the personal-site
graph has real schema and write behavior.

Consumers should pass absolute paths and close returned handles when their server
shuts down.
