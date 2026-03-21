# Branch 5: Blob, Ingestion, And Media

Canonical spec: [`05-blob-ingestion-and-media-canonical.md`](./05-blob-ingestion-and-media-canonical.md)

## Mission

Give the graph a durable blob tier and an asynchronous ingestion pipeline so
files, documents, images, and imports become first-class product capabilities.

## Why This Is A Separate Branch

Blob handling, extraction, and provenance have different runtime constraints
from the graph fact store. They touch R2, Queues, background jobs, and module
families that do not belong inside the core authority branch.

## In Scope

- blob metadata entities and references
- R2 object storage integration
- queue-backed ingest and extraction jobs
- provenance and processing status tracking
- file, image, and document foundation module families
- extraction outputs such as metadata, previews, OCR text, or structured import
  results

## Out Of Scope

- every future connector type
- advanced ML extraction quality
- broad sync connector catalog

## Durable Contracts Owned

- blob record model
- ingest job and processing-state model
- provenance links from derived data back to raw input
- object-storage reference contracts

## Likely Repo Boundaries

- future blob and ingest runtime packages
- foundation modules for files, images, and documents
- queue consumers and R2 adapters

## Dependencies

- Branch 1 for blob entities and authoritative persistence
- Branch 4 for module family registration
- Branch 3 for derived retrieval indexes, where needed

## Downstream Consumers

- Branch 6 needs ingest artifacts and review tasks
- Branch 7 needs upload, preview, and processing-status surfaces

## First Shippable Milestone

Support one end-to-end blob flow: upload a file, persist its blob record, run
one extraction job, and materialize a derived graph artifact.

## Done Means

- raw files are stored outside the graph fact store
- graph metadata tracks ownership, status, and provenance
- extraction can fail or succeed without corrupting the graph
- one document or media family is usable in product surfaces

## First Demo

Upload a PDF or image, watch the processing status move through the queue, and
view the extracted metadata or preview in the app.

## What This Unlocks

- import and export workflows
- richer document and media modules
- agent access to durable artifacts derived from ingested content

## Source Anchors

- `doc/03-target-platform-architecture.md`
- `doc/05-recommended-architecture.md`
- `doc/06-migration-plan.md`
- `doc/09-vision-platform-architecture.md`
- `doc/10-vision-product-model.md`
- `doc/11-vision-execution-model.md`
