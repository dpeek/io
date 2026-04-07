---
name: Graph client transport
description: "HTTP sync requests, HTTP graph client wiring, and serialized-query transport helpers in @io/graph-client."
last_updated: 2026-04-02
---

# Graph client transport

## Read this when

- you are changing HTTP sync request encoding or the HTTP graph client
- you need to understand serialized-query request or response validation
- you are wiring graph-client transport to a browser, MCP, or another remote caller

## Main source anchors

- `../src/http.ts`: HTTP graph client and serialized-query request helper
- `../src/http-sync-request.ts`: sync request URL encoding and decoding
- `../src/serialized-query.ts`: serialized query contract, validation, and normalization
- `../src/http-sync-request.test.ts`: sync request transport examples
- `../src/serialized-query.test.ts`: serialized query envelope validation examples
- `../../graph-query/doc/query-stack.md`: broader cross-package query architecture

## HTTP sync request shape

`applyHttpSyncRequest()` and `readHttpSyncRequest()` are the shared URL helpers for sync transport.

Rules:

- `after` is optional
- graph scope encodes as `scopeKind=graph`
- module scope encodes as:
  - `scopeKind=module`
  - `moduleId`
  - `scopeId`

Unknown scope kinds fail closed.

## HTTP graph client

`createHttpGraphClient()` composes:

- `createSyncedGraphClient()`
- one sync pull endpoint
- one transaction push endpoint
- optional bearer-token auth
- optional bootstrap or schema snapshot inputs

It fetches an initial sync payload immediately after construction.

`createHttpGraphTxIdFactory()` provides the default local tx id generator for that client path.

## Serialized query transport

`requestSerializedQuery()` is the transport helper for `POST /api/query`-style envelopes:

- request body is JSON
- response payload is validated through `validateSerializedQueryResponse()`
- non-OK responses raise `HttpSerializedQueryClientError`

This helper is transport-only. Query execution, authorization, and executor registration live above this package.

## Serialized query contract

`serialized-query.ts` owns the transport-safe query envelope:

- versioned request and response shapes
- bounded query families:
  - `entity`
  - `neighborhood`
  - `collection`
  - `scope`
- bounded filter, ordering, parameter, and window shapes
- normalization helpers that resolve defaults and validate parameter bindings

`validateSerializedQueryRequest()` validates the envelope.
`normalizeSerializedQueryRequest()` validates and then normalizes it for execution.
`validateSerializedQueryResponse()` validates the response envelope.

## Practical rules

- Keep sync request URL encoding and decoding symmetrical in `http-sync-request.ts`.
- Keep HTTP graph client behavior transport-focused; do not move authority policy or query execution logic here.
- Treat serialized query normalization as a transport-contract step, not as execution.
- Keep the query family set bounded and explicit; do not add arbitrary graph-scan transport shapes here.
