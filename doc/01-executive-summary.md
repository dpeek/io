# Executive Summary

This document captures the top-level thesis from [`../roadmap.md`](../roadmap.md).

## Current State

`io` already looks like more than a prototype. The repo currently proves four
meaningful surfaces:

- a graph-first kernel with stable ids, append-oriented facts, typed refs,
  validation, commit-oriented SQLite-backed authoritative persistence, and
  total plus incremental sync
- a Worker-backed web surface running a TanStack Router SPA with a graph
  explorer and sync tooling
- an issue-driven agent runtime with workflow loading, context assembly,
  scheduling, and an operator TUI
- a credible architectural direction toward predicate-level authority, secret
  handling, type-local business methods, and module-shaped extensibility

## Target Product

The target product described in `vision.md` is substantially larger:

- open-source and self-hostable on Cloudflare
- one logical graph per user with many physical shards
- predicate-level privacy and scoped sync
- installable modules with graph-native workflow
- durable agent memory, blob storage, federation, and sharing

## Migration Thesis

The recommended path is evolutionary rather than a rewrite:

- keep the current graph contracts
- build on the shipped SQLite-backed Durable Object row-persistence baseline
  and harden retention, recovery, and cursor behavior
- formalize module manifests and install-time permissions
- move workflow state from Linear-centric automation into graph-native types
- introduce scoped sync and materialized indexes before sharding
- split the single authority into a directory object plus subject-home shard
  objects only after those contracts are stable
- add capability-based federation last

## Central Recommendation

Treat the current repo as a strong proof of a single-authority graph kernel plus
operator tooling. Promote only a small set of contracts to stable platform
primitives first:

- graph ids, schema, facts, and validation
- authoritative write/session model
- sync contracts
- type-module contracts
- authority and policy metadata
- module manifest and install contracts

Everything else should layer on top of those primitives.
