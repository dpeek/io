# Branch 5 Canonical: Blob, Ingestion, And Media

## Overview

### Mission

Give the graph a durable blob tier and an asynchronous ingestion pipeline so
files, documents, images, and imports become first-class product capabilities.

### Why This Is A Separate Branch

Blob handling, extraction, and provenance have different runtime constraints
from the graph fact store. They touch R2, Queues, background jobs, and module
families that do not belong inside the core authority branch.

### In Scope

- blob metadata entities and references
- R2 object storage integration
- queue-backed ingest and extraction jobs
- provenance and processing status tracking
- file, image, and document foundation module families
- extraction outputs such as metadata, previews, OCR text, or structured import
  results

### Out Of Scope

- every future connector type
- advanced ML extraction quality
- broad sync connector catalog

### Durable Contracts Owned

- blob record model
- ingest job and processing-state model
- provenance links from derived data back to raw input
- object-storage reference contracts

### Likely Repo Boundaries

- future blob and ingest runtime packages
- foundation modules for files, images, and documents
- queue consumers and R2 adapters

### Dependencies

- Branch 1 for blob entities and authoritative persistence
- Branch 4 for module family registration
- Branch 3 for derived retrieval indexes, where needed

### Downstream Consumers

- Branch 6 needs ingest artifacts and review tasks
- Branch 7 needs upload, preview, and processing-status surfaces

### First Shippable Milestone

Support one end-to-end blob flow: upload a file, persist its blob record, run
one extraction job, and materialize a derived graph artifact.

### Done Means

- raw files are stored outside the graph fact store
- graph metadata tracks ownership, status, and provenance
- extraction can fail or succeed without corrupting the graph
- one document or media family is usable in product surfaces

### First Demo

Upload a PDF or image, watch the processing status move through the queue, and
view the extracted metadata or preview in the app.

### What This Unlocks

- import and export workflows
- richer document and media modules
- agent access to durable artifacts derived from ingested content

### Source Anchors

- `doc/03-target-platform-architecture.md`
- `doc/05-recommended-architecture.md`
- `doc/06-migration-plan.md`
- `doc/09-vision-platform-architecture.md`
- `doc/10-vision-product-model.md`
- `doc/11-vision-execution-model.md`

The remainder of this document defines the canonical implementation contract
for the blob tier, asynchronous ingestion pipeline, and first file, image, and
document module families.

It is grounded in:

- [`../03-target-platform-architecture.md`](../03-target-platform-architecture.md)
- [`../05-recommended-architecture.md`](../05-recommended-architecture.md)
- [`../06-migration-plan.md`](../06-migration-plan.md)
- [`../09-vision-platform-architecture.md`](../09-vision-platform-architecture.md)
- [`../10-vision-product-model.md`](../10-vision-product-model.md)
- [`../11-vision-execution-model.md`](../11-vision-execution-model.md)
- [`../../roadmap.md`](../../roadmap.md)
- [`../../vision.md`](../../vision.md)

## 1. Purpose

Branch 5 owns the platform contract for large, durable artifacts that should
not live inside the graph fact store itself.

Its job is to make uploads, imports, documents, images, and other media
first-class graph-backed capabilities without collapsing raw object storage,
background extraction, and provenance into ad hoc web-only code.

This branch exists separately because it owns a different runtime shape from
the graph kernel:

- raw bytes live in R2, not in graph fact rows
- extraction is asynchronous and at-least-once, not inline with user writes
- derived outputs may be binary, text, or structured data
- failures must preserve raw inputs and provenance even when extraction fails

Platform outcomes this branch must deliver:

- one durable blob tier for raw and derived artifacts
- one canonical metadata model for blobs, ingest jobs, derivatives, and
  provenance
- one asynchronous processing model that supports retry, reprocess, and review
- one module-facing registration model for file, image, and document families

## 2. Scope

### In scope

- blob metadata entities and object-storage references
- upload staging and finalize contracts
- R2 object layout and immutability rules
- ingest job lifecycle, retry, and idempotency rules
- extraction outputs such as previews, OCR text, metadata, and structured
  import payloads
- provenance from raw inputs to derived graph entities or derivatives
- built-in file, image, and document foundation module families
- observability for upload, queue, extraction, and reprocess paths

### Out of scope

- a broad connector marketplace
- final OCR, vision, or parsing model quality
- full-text and retrieval index design beyond the contract this branch exports
- final review-task UX and operator shell polish
- direct ownership of auth, query planner, or generic workflow contracts

### Upstream assumptions

- Branch 1 provides stable graph ids, transaction ordering, and authoritative
  graph writes
- Branch 2 provides principal-aware policy and capability checks
- Branch 3 will consume extraction outputs into projections and scoped queries
- Branch 4 will define the install-time manifest and registration model that
  blob-backed modules plug into
- Branch 6 will eventually own review tasks and durable workflow artifacts
- Branch 7 will consume the upload, preview, and status contracts for product
  surfaces

## 3. Core Model

Branch 5 owns four durable concepts:

- `BlobRecord`: one immutable stored raw artifact
- `IngestJobRecord`: one asynchronous processing request against a blob
- `BlobDerivativeRecord`: one derived output produced from a blob or job
- `BlobProvenanceRecord`: one link from raw input and extractor run to derived
  data

The graph stores metadata and lifecycle state for those records. R2 stores raw
bytes and derived binary payloads. The queue is never authoritative.

### Core identifiers

- `BlobId`: stable graph entity id for one immutable raw object
- `IngestJobId`: stable graph entity id for one queued or completed processing
  run
- `BlobDerivativeId`: stable graph entity id for one derivative artifact
- `BlobProvenanceId`: stable graph entity id or edge-local identity for one
  provenance assertion
- `UploadSessionId`: short-lived staging id used before a blob record exists
- `ExtractorRevision`: module-qualified extractor version string such as
  `document/pdf-text@1`

### Blob classes and kinds

`blobClass` is a stable product contract that controls validation,
registration, and eligible extractors. Initial stable classes are:

- `file`
- `image`
- `document`
- `import-source`

`derivativeKind` is a stable output contract. Initial stable kinds are:

- `preview-image`
- `thumbnail`
- `ocr-text`
- `extracted-metadata`
- `structured-import`

Additional classes and derivative kinds may be added later without changing the
base model.

### Durable entity shapes

```ts
type BlobAvailability = "available" | "quarantined" | "deleted";

type BlobProcessingStatus =
  | "none"
  | "queued"
  | "running"
  | "awaiting-review"
  | "complete"
  | "failed";

type IngestJobState =
  | "queued"
  | "running"
  | "awaiting-review"
  | "succeeded"
  | "failed"
  | "cancelled";

type BlobClass = "file" | "image" | "document" | "import-source";

type BlobDerivativeKind =
  | "preview-image"
  | "thumbnail"
  | "ocr-text"
  | "extracted-metadata"
  | "structured-import";

interface ObjectStorageRef {
  provider: "r2";
  bucketBinding: string;
  objectKey: string;
  etag?: string;
  sha256: string;
}

interface BlobRecord {
  id: string;
  blobClass: BlobClass;
  mediaType: string;
  byteLength: number;
  originalFilename?: string;
  sha256: string;
  availability: BlobAvailability;
  processingStatus: BlobProcessingStatus;
  storage: ObjectStorageRef;
  ownerEntityId?: string;
  createdById: string;
  createdAt: string;
  sealedAt: string;
  activeJobId?: string;
}

interface IngestLease {
  token: string;
  workerId: string;
  claimedAt: string;
  expiresAt: string;
}

interface IngestJobRecord {
  id: string;
  blobId: string;
  moduleId: string;
  extractorKey: string;
  extractorRevision: string;
  state: IngestJobState;
  requestedById: string;
  requestedAt: string;
  startedAt?: string;
  completedAt?: string;
  retryCount: number;
  lease?: IngestLease;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  reviewReason?: string;
  outputIds: readonly string[];
  dedupeKey: string;
}

interface BlobDerivativeRecord {
  id: string;
  blobId: string;
  jobId: string;
  kind: BlobDerivativeKind;
  storage?: ObjectStorageRef;
  metadata: Record<string, unknown>;
  extractorRevision: string;
  createdAt: string;
}

interface BlobProvenanceRecord {
  id: string;
  blobId: string;
  jobId: string;
  derivativeId?: string;
  targetEntityId?: string;
  targetPredicateKey?: string;
  locator?: Record<string, string | number>;
  confidence?: number;
  createdAt: string;
}
```

### Lifecycle rules

- A `BlobRecord` is immutable with respect to raw bytes. Replacing content
  creates a new blob, not a mutation of the existing blob.
- An upload session is not a blob. It is an ephemeral staging contract that may
  expire without leaving graph state behind.
- A blob may have many ingest jobs over time, but at most one active job per
  `dedupeKey`.
- A derivative is immutable. Reprocessing creates a new derivative record,
  after which graph references may move to that newer derivative.
- Provenance must survive extractor upgrades and reprocess runs; newer outputs
  add new provenance rather than overwriting history.

### Relationship model

- Any domain entity may hold a reference to a `BlobRecord`
- One `BlobRecord` may own zero or more `BlobDerivativeRecord`s
- One `BlobRecord` may own zero or more `IngestJobRecord`s
- One `IngestJobRecord` may produce zero or more derivatives
- Provenance may point at a derivative, a normalized graph entity, or a
  predicate-level write produced from the blob

## 4. Public Contract Surface

### `ObjectStorageRef`

- Purpose: canonical reference to a raw or derived object stored outside the
  graph fact store
- Caller: Branch 5 graph entities, Branch 7 preview/download surfaces, Branch 3
  projection builders
- Callee: R2 adapter or any server-side object fetch path
- Inputs: `provider`, `bucketBinding`, `objectKey`, digest, optional `etag`
- Outputs: object lookup target for server-side fetch or signed access
- Failure shape: missing object, digest mismatch, unauthorized access
- Stability: `stable`

### `BlobRecord`

- Purpose: durable graph metadata for one immutable raw object
- Caller: Branch 7 upload surfaces, Branch 6 artifact consumers, Branch 3
  projection builders
- Callee: Branch 1 authoritative graph write path
- Inputs: blob class, MIME, size, digest, storage ref, owner linkage, creator
- Outputs: graph entity id and durable metadata visible to downstream branches
- Failure shape: validation rejection, duplicate finalize, policy rejection
- Stability: `stable`

### `IngestJobRecord`

- Purpose: durable, user-visible status for asynchronous extraction or import
- Caller: upload finalize flow, reprocess command, connectors, queue consumer
- Callee: Branch 1 authoritative graph write path
- Inputs: blob id, module and extractor identity, dedupe key, requester
  identity
- Outputs: queued or updated job state plus retry and error metadata
- Failure shape: duplicate active job, invalid state transition, policy
  rejection
- Stability: `stable`

### `BlobUploadSession`

- Purpose: two-step upload staging contract that prevents graph records from
  pointing at missing objects
- Caller: browser upload UI, import connector, operator tooling
- Callee: Worker upload route owned by Branch 5 and consumed by Branch 7
- Inputs: desired `blobClass`, filename hint, media type hint, size hint, owner
  target, requester identity
- Outputs: `sessionId`, staging target, expiry, allowed size, finalize token
- Failure shape: rejected media class, size limit violation, unauthenticated
  request, expired session
- Stability: `provisional`

### `FinalizeBlobUpload`

- Purpose: convert a staged object into a durable graph blob plus an initial
  ingest job
- Caller: browser upload UI, import connector, server-side bulk import path
- Callee: Worker finalize route, which then writes through Branch 1 authority
- Inputs: `sessionId`, observed digest, final filename and MIME, owner linkage,
  optional requested extractor profile
- Outputs: `{ blobId, jobId, processingStatus }`
- Failure shape: staged object missing, digest mismatch, duplicate finalize,
  graph write failure, enqueue failure
- Stability: `stable`

### `BlobIngestQueueMessage`

- Purpose: canonical queue envelope for at-least-once asynchronous processing
- Caller: finalize route, reprocess command, connector import flow
- Callee: queue consumer runtime
- Inputs:

```ts
interface BlobIngestQueueMessage {
  kind: "blob.ingest";
  jobId: string;
  blobId: string;
  moduleId: string;
  extractorKey: string;
  extractorRevision: string;
  enqueuedAt: string;
}
```

- Outputs: queue delivery to a processor that claims the referenced job
- Failure shape: duplicate delivery, stale revision, missing job, missing blob
- Stability: `stable`

### `BlobExtractor`

- Purpose: module-owned extraction contract for raw blobs
- Caller: queue consumer runtime
- Callee: module-provided extractor implementation
- Inputs:

```ts
interface BlobExtractorInput {
  blob: BlobRecord;
  job: IngestJobRecord;
  fetchObject(ref: ObjectStorageRef): Promise<ArrayBuffer>;
}

interface BlobExtractorOutput {
  derivatives?: readonly {
    kind: BlobDerivativeKind;
    contentType: string;
    bytes?: ArrayBuffer;
    metadata?: Record<string, unknown>;
  }[];
  graphWrites?: readonly {
    entityType: string;
    values: Record<string, unknown>;
    provenance?: Record<string, unknown>;
  }[];
  reviewReason?: string;
}
```

- Outputs: derivative objects, normalized graph writes, optional review signal
- Failure shape: non-retryable parse failure, retryable infra failure, policy
  violation, unsupported media type
- Stability: `provisional`

### `BlobModuleContribution`

- Purpose: Branch 4 manifest fragment for module families that accept or derive
  blob-backed content
- Caller: module installer and registry
- Callee: Branch 5 runtime and queue consumer
- Inputs:

```ts
interface BlobModuleContribution {
  blobClasses: readonly BlobClass[];
  extractors: readonly {
    key: string;
    revision: string;
    accepts: readonly string[];
    produces: readonly BlobDerivativeKind[];
  }[];
  commands?: readonly string[];
  objectViews?: readonly string[];
}
```

- Outputs: registration of eligible extractors, views, and commands
- Failure shape: duplicate extractor keys, unsupported blob class, incompatible
  runtime revision
- Stability: `provisional`

### `blob.reprocess`

- Purpose: server-side command to enqueue a new ingest job for an existing blob
- Caller: Branch 7 operator UI, Branch 6 workflow automation, recovery tooling
- Callee: Branch 5 authority-facing command implementation
- Inputs: `blobId`, optional `extractorKey`, optional `reason`
- Outputs: `jobId`
- Failure shape: blob missing, already processing, extractor unavailable, policy
  rejection
- Stability: `stable`

## 5. Runtime Architecture

The current proof and the target platform share one core runtime split:

- Worker routes accept uploads, finalize blobs, and serve previews or downloads
- Branch 1 authority runtime persists blob metadata, job state, and provenance
- R2 stores raw bytes and derived binary payloads
- Queue consumers run extraction asynchronously

### Current single-graph proof

For the current repo shape, the simplest valid runtime is:

1. browser or connector calls Worker upload route
2. Worker creates a short-lived upload session
3. staged bytes land in R2
4. Worker finalize route verifies staged object presence, computes or verifies
   metadata, and writes `BlobRecord` plus `IngestJobRecord` through the current
   `GRAPH_AUTHORITY` Durable Object path
5. Worker enqueues one `BlobIngestQueueMessage`
6. queue consumer claims the job through the same authority, fetches the raw
   object from R2, runs the extractor, stores derivatives, and commits graph
   writes and provenance

### Future sharded runtime

When Branch 1 and Branch 3 move to directory-plus-shard topology:

- directory or shard routing determines the home authority for the blob and its
  jobs
- R2 remains the blob byte store and does not become shard-local
- queue consumers stay stateless and discover the home authority through the
  graph routing contract
- Branch 3 projections consume the resulting blob and provenance entities into
  queryable indexes

### Authoritative versus derived state

Authoritative state:

- `BlobRecord`
- `IngestJobRecord`
- `BlobDerivativeRecord`
- `BlobProvenanceRecord`
- raw bytes in R2 under immutable object keys

Derived or rebuildable state:

- previews regenerated from raw blobs
- OCR text or structured import indexes used for search and retrieval
- queue backlog and lease timing beyond the current durable job record
- UI-specific status aggregations

### Local versus remote responsibilities

- browser clients may upload and poll status, but they never write R2 or graph
  metadata directly
- only server paths finalize blobs, claim jobs, write provenance, or expose raw
  object bytes
- extractor implementations may be module-local, but they always commit through
  the authority boundary

## 6. Storage Model

Branch 5 owns a multi-tier storage contract rather than one new SQL schema.

### Graph-owned durable records

These records live in Branch 1 authoritative graph storage:

- blob metadata
- processing state
- derivative metadata
- provenance edges or entities

Branch 5 does not define a second authoritative relational store for those
records in the current proof. It relies on Branch 1 transaction history and
current edge state for durability.

### R2 object layout

R2 stores:

- staged uploads
- immutable raw blobs
- immutable derived binary artifacts such as thumbnails or preview images

Canonical object classes:

- `staging/<uploadSessionId>`
- `raw/<blobId>/<sha256>`
- `derived/<blobId>/<derivativeId>/<kind>`

The stable rule is not the exact string prefix. The stable rule is:

- staged objects are temporary and may be deleted without graph mutation
- raw and derived objects are immutable once published
- graph metadata must not point at an object key until that object exists

### Retention and rebuild rules

- current job status lives in graph state; past status transitions live in graph
  history through Branch 1 transaction retention
- queue delivery state is disposable and may be rebuilt by re-enqueueing jobs
  still marked `queued`, `running` with expired leases, or explicitly `failed`
  and retryable
- previews and other derivatives may be regenerated from raw blobs
- search or retrieval indexes over extracted text are Branch 3 projections and
  must be rebuildable from graph metadata plus raw or derived blob state

### Migration expectations

- extractor revisions must be versioned so old blobs can be reprocessed
- new module versions may register new derivative kinds without mutating old raw
  blobs
- namespace naming for blob-backed foundation modules may still move while the
  underlying blob, job, derivative, and provenance contracts stay fixed

## 7. Integration Points

### Branch 1: Graph Kernel And Authority

- Dependency direction: Branch 5 depends on Branch 1
- Imported contracts: stable ids, authoritative transactions, durable graph
  writes, secret-handle boundary, persisted authority behavior
- Exported contracts: blob, job, derivative, and provenance entity models
- Mockable or provisional: current Worker route glue and one-authority topology
- Must be stable first: authoritative write idempotency and cursor-preserving
  persistence

### Branch 2: Identity, Policy, And Sharing

- Dependency direction: Branch 5 depends on Branch 2 for access control
- Imported contracts: principal identity, upload permission checks, object-read
  capability checks, shareability rules
- Exported contracts: blob-specific policy requirements such as "derivatives may
  not widen visibility beyond the source blob"
- Mockable or provisional: precise capability naming
- Must be stable first: at least one server-side permission check surface for
  upload, reprocess, and download

### Branch 3: Sync, Query, And Projections

- Dependency direction: Branch 3 consumes Branch 5 outputs
- Imported contracts: projection registration and scoped query surfaces
- Exported contracts: extraction outputs, status entities, and provenance-rich
  normalized graph writes
- Mockable or provisional: search and retrieval projections, live update shape
- Must be stable first: none for the first single-flow milestone; narrow
  projection hooks are enough

### Branch 4: Module Runtime And Installation

- Dependency direction: Branch 5 depends on Branch 4 for installation and
  registration
- Imported contracts: module manifest, compatibility checks, module-owned
  command and view registration
- Exported contracts: `BlobModuleContribution`, extractor registration rules,
  built-in file, image, and document module families
- Mockable or provisional: final manifest file format
- Must be stable first: one installer-owned registration hook for extractor
  discovery

### Branch 6: Workflow And Agent Runtime

- Dependency direction: Branch 6 consumes Branch 5 status and outputs
- Imported contracts: none are required for the first milestone
- Exported contracts: review-needed jobs, ingest artifacts, provenance-rich
  outputs that Branch 6 may mirror into run or artifact records
- Mockable or provisional: review task creation path
- Must be stable first: none for upload-plus-one-extractor; review can remain a
  status-only signal at first

### Branch 7: Web And Operator Surfaces

- Dependency direction: Branch 7 consumes Branch 5
- Imported contracts: upload session, finalize route, status reads, preview and
  download access rules
- Exported contracts: none; Branch 7 is the main UI consumer
- Mockable or provisional: final route shapes and progress UI
- Must be stable first: finalize response shape, blob status semantics, and one
  preview or download contract

## 8. Main Flows

### 1. Upload and queue one blob

1. Initiator: browser UI or import connector
2. Components: Worker upload route, R2 staging object, Worker finalize route,
   Branch 1 authority, queue
3. Boundaries crossed: browser -> Worker, Worker -> R2, Worker -> authority,
   Worker -> queue
4. Authoritative write point: finalize route commits `BlobRecord` and
   `IngestJobRecord`
5. Failure behavior: if staging upload never completes or finalize fails, no
   blob record is created; staged bytes are later garbage-collected

### 2. Claim, extract, and commit outputs

1. Initiator: queue consumer after `blob.ingest` delivery
2. Components: queue consumer, Branch 1 authority, R2 raw object, module
   extractor, R2 derived object writes
3. Boundaries crossed: queue -> consumer, consumer -> authority, consumer ->
   R2, consumer -> extractor
4. Authoritative write point: consumer commits job state, derivative metadata,
   provenance, and normalized graph writes through authority
5. Failure behavior: duplicate deliveries are absorbed by job claim rules; raw
   blob stays intact; orphaned derived objects may exist temporarily and are
   swept later rather than corrupting graph state

### 3. Surface review-needed outputs

1. Initiator: extractor returns `reviewReason`
2. Components: queue consumer, authority, Branch 7 UI, later Branch 6 workflow
3. Boundaries crossed: consumer -> authority, UI -> status read
4. Authoritative write point: job state moves to `awaiting-review`
5. Failure behavior: the blob remains available and provenance is preserved;
   there is no silent partial import

### 4. Reprocess after module or extractor upgrade

1. Initiator: operator, workflow automation, or migration task
2. Components: `blob.reprocess`, authority, queue, extractor
3. Boundaries crossed: caller -> command path, command -> authority, authority
   -> queue
4. Authoritative write point: new `IngestJobRecord` is created with a new
   extractor revision
5. Failure behavior: prior derivatives and provenance remain readable until the
   new run succeeds and downstream references deliberately advance

### 5. Serve download or preview

1. Initiator: browser client or agent surface
2. Components: Worker download route, authority-backed metadata read, R2 object
   fetch
3. Boundaries crossed: client -> Worker, Worker -> authority, Worker -> R2
4. Authoritative write point: none for ordinary reads
5. Failure behavior: missing derivative falls back to raw blob or a "not yet
   available" state; permissions are checked before any object bytes are
   streamed

## 9. Invariants And Failure Handling

### Invariants

- Raw blob bytes are immutable after finalize.
- A durable blob record must never reference a raw object key that does not
  exist.
- Queue delivery is at-least-once, so all ingest processing must be idempotent
  at the job level.
- At most one active job may exist for one `dedupeKey`.
- Derivative metadata must never be published before the derivative object
  exists when that derivative lives in R2.
- Every normalized graph write produced from ingestion must have provenance back
  to the source blob and job.
- Derivatives and previews may never widen visibility beyond the source blob.
- Extraction failure must not corrupt the source blob, its graph metadata, or
  unrelated graph entities.

### Failure modes

`staged upload abandoned`

- What fails: client uploads bytes but never finalizes
- Must not corrupt: graph state
- Retry or fallback: none; garbage collector deletes staged object after TTL
- Observability: staged-object age and abandoned-session count

`finalize sees missing or mismatched object`

- What fails: staged object missing or digest mismatch
- Must not corrupt: authoritative graph and queue
- Retry or fallback: caller may retry finalize only if the same upload session
  is still valid; otherwise start a new upload
- Observability: finalize rejection count by reason

`queue redelivery`

- What fails: same queue message is delivered more than once
- Must not corrupt: duplicate derivatives or repeated graph writes
- Retry or fallback: only the first successful claim advances the job; later
  deliveries become no-ops
- Observability: duplicate-claim rate

`extractor crash after writing derived object`

- What fails: derived R2 object may exist, graph commit does not
- Must not corrupt: source blob or prior graph state
- Retry or fallback: rerun job; orphan sweeper removes unreachable derivatives
- Observability: orphan derivative count and commit-after-derive failures

`authoritative graph commit fails`

- What fails: job update or normalized graph write is rejected
- Must not corrupt: source blob, prior derivatives, or unrelated graph state
- Retry or fallback: mark retryable when possible; otherwise mark job failed
- Observability: job failure count by error code and retryability

`extractor output confidence too low`

- What fails: automatic normalization cannot proceed safely
- Must not corrupt: graph semantics by low-confidence writes
- Retry or fallback: set job to `awaiting-review`, persist provenance for what
  was observed, defer final semantic writes
- Observability: review-needed count by extractor and blob class

## 10. Security And Policy Considerations

- Raw and derived object keys are authority-only implementation details. Clients
  do not receive direct bucket access.
- Download and preview paths must check graph policy before streaming any bytes.
- Blob visibility is constrained by the source blob and, when attached to a
  parent entity, by the effective visibility of that attachment.
- Derivatives inherit the most restrictive visibility of the source blob and
  the target entity they inform.
- Secrets used by connectors or external extraction services stay behind the
  Branch 1 and Branch 2 secret boundary. Blob metadata must not embed secret
  plaintext.
- Queue consumers run with authority privileges and therefore must treat all
  extractor output as untrusted until validated and normalized.
- Quarantine is a first-class availability state so malware, unsupported
  content, or policy violations can block preview and downstream use without
  deleting the raw forensic input immediately.

## 11. Implementation Slices

### Slice 1: Blob contracts and built-in types

- Goal: land stable graph entity contracts for blobs, jobs, derivatives, and
  provenance
- Prerequisite contracts: Branch 1 ids and authoritative writes
- What it proves: other branches can target a stable metadata model before the
  full runtime exists
- What it postpones: R2 uploads, queue workers, and extractor implementations

### Slice 2: Upload session plus finalize

- Goal: support one browser upload that produces one `BlobRecord` and one
  queued job
- Prerequisite contracts: Slice 1, current Worker authority path
- What it proves: graph metadata and raw object bytes can be committed without
  inline extraction
- What it postpones: previews, OCR, and structured import

### Slice 3: One extractor and one derivative

- Goal: process one PDF or image into one preview or metadata derivative
- Prerequisite contracts: queue envelope, R2 adapter, one module extractor
- What it proves: at-least-once extraction with provenance and retry safety
- What it postpones: rich review flows, many derivative kinds, connector sync

### Slice 4: Reprocess, retry, and observability

- Goal: allow manual or automated re-enqueue plus basic operator inspection
- Prerequisite contracts: Slice 3, one status surface in Branch 7
- What it proves: extractor revisions can evolve without data loss
- What it postpones: full workflow-native review tasks

### Slice 5: File, image, and document module families

- Goal: register built-in module families around the shared blob substrate
- Prerequisite contracts: Branch 4 registration hooks
- What it proves: Branch 5 is a reusable platform substrate rather than a one
  off upload feature
- What it postpones: external connector marketplace and advanced ML pipelines

## 12. Open Questions

- Should large extracted text always live as a blob derivative in R2, or may
  smaller OCR or extracted-text payloads be stored directly as graph values?
- Should the first upload path be direct-to-R2 with signed upload targets, or
  Worker-streamed for simpler early correctness?
- Does quarantine require a dedicated malware-scanning stage in the first
  implementation slice, or is the state initially only policy-driven?
- Which namespace layout is best for the built-in module families:
  `files:`, `documents:`, and `media:` or a smaller shared `blob:` family plus
  module-local types?
- How much extractor execution should stay inside Workers versus calling an
  external service for OCR or document parsing once limits are better
  understood?
- When Branch 6 lands, should review-needed ingestion results become workflow
  tasks automatically or only after an installer opt-in from the owning module?

## 13. Recommended First Code Targets

- Add one new built-in module family under `lib/app/src/graph/modules/` for blob, job,
  derivative, and provenance types plus one initial file or document slice.
- Add one shared Branch 5 contract module for `ObjectStorageRef`,
  `BlobIngestQueueMessage`, and extractor registration types so Worker,
  queue-consumer, and module code do not re-declare them.
- Extend `lib/app/src/web/worker/index.ts` and `lib/app/src/web/lib/server-routes.ts` with
  upload-session, finalize, and object-read routes.
- Add a new Worker-side runtime surface beside `lib/app/src/web/lib/authority.ts` for
  R2 upload verification, queue enqueue, and blob read access checks.
- Add one queue-consumer runtime package or directory for job claim, extractor
  dispatch, derivative write, provenance commit, retry, and orphan sweeping.
