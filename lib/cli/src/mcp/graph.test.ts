import { describe, expect, it } from "bun:test";

import {
  createAuthoritativeGraphWriteSession,
  createAuthoritativeTotalSyncPayload,
} from "@io/graph-authority";
import { createBootstrappedSnapshot } from "@io/graph-bootstrap";
import { createGraphClient, type FetchImpl, type GraphClient } from "@io/graph-client";
import {
  createGraphStore,
  type AnyTypeOutput,
  type AuthoritativeGraphWriteResult,
  type GraphStoreSnapshot,
  type GraphWriteTransaction,
} from "@io/graph-kernel";
import { kitchenSink } from "@io/graph-integration";
import { core, coreGraphBootstrapOptions } from "@io/graph-module-core";
import { workflow } from "@io/graph-module-workflow";
import { type SyncPayload } from "@io/graph-sync";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createGraphMcpServer, createGraphMcpSession } from "./graph.js";

const productGraph = { ...workflow } as const;

type GraphNamespace = Record<string, AnyTypeOutput>;
type MockAuthority = {
  readonly namespace: GraphNamespace;
  readonly store: ReturnType<typeof createGraphStore>;
  readonly writes: {
    apply(transaction: GraphWriteTransaction): AuthoritativeGraphWriteResult;
    getBaseCursor(): string;
    getCursor(): string | undefined;
    getIncrementalSyncResult(after: string): SyncPayload;
  };
};

let productAuthoritySnapshot: GraphStoreSnapshot | null = null;
let kitchenSinkAuthoritySnapshot: GraphStoreSnapshot | null = null;

function resolvedEnumValue(value: { key: string; id?: string }): string {
  return value.id ?? value.key;
}

function createAuthority<const T extends GraphNamespace>(
  namespace: T,
  seed: (graph: GraphClient<typeof core & T>) => void,
) {
  const definitions = { ...core, ...namespace } as const;
  const store = createGraphStore(
    createBootstrappedSnapshot(definitions, coreGraphBootstrapOptions),
  );
  const graph = createGraphClient(store, definitions, definitions) as unknown as GraphClient<
    typeof core & T
  >;
  seed(graph);
  const writes = createAuthoritativeGraphWriteSession(
    store,
    { ...core, ...namespace },
    {
      cursorPrefix: "server:",
    },
  );

  return { graph, namespace: { ...core, ...namespace }, store, writes };
}

function createAuthorityFromSnapshot<const T extends GraphNamespace>(
  namespace: T,
  snapshot: GraphStoreSnapshot,
) {
  const definitions = { ...core, ...namespace } as const;
  const store = createGraphStore(snapshot);
  const graph = createGraphClient(store, definitions, definitions) as unknown as GraphClient<
    typeof core & T
  >;
  const writes = createAuthoritativeGraphWriteSession(
    store,
    { ...core, ...namespace },
    {
      cursorPrefix: "server:",
    },
  );

  return { graph, namespace: { ...core, ...namespace }, store, writes };
}

function createProductAuthority() {
  if (!productAuthoritySnapshot) {
    productAuthoritySnapshot = createAuthority(productGraph, (graph) => {
      graph.envVar.create({ name: "OPENAI_API_KEY" });
      graph.document.create({
        description: "Seeded document",
        isArchived: false,
        name: "Graph MCP",
        slug: "graph-mcp",
      });
    }).store.snapshot();
  }

  const snapshot = productAuthoritySnapshot;
  if (!snapshot) throw new Error("Product authority snapshot was not initialized.");
  return createAuthorityFromSnapshot(productGraph, snapshot);
}

function createKitchenSinkAuthority() {
  if (!kitchenSinkAuthoritySnapshot) {
    kitchenSinkAuthoritySnapshot = createAuthority(kitchenSink, (graph) => {
      const tagId = graph.tag.create({
        color: "#1d4ed8",
        key: "platform",
        name: "Platform",
      });
      const companyId = graph.company.create({
        foundedYear: 2020,
        name: "Acme",
        status: resolvedEnumValue(kitchenSink.status.values.approved),
        website: new URL("https://acme.example"),
      });
      const managerId = graph.person.create({
        confidentialNotes: "manager-only",
        email: "manager@example.com",
        name: "Manager",
        status: resolvedEnumValue(kitchenSink.status.values.approved),
        worksAt: [companyId],
      });
      const reviewerId = graph.person.create({
        email: "reviewer@example.com",
        name: "Reviewer",
        status: resolvedEnumValue(kitchenSink.status.values.approved),
        worksAt: [companyId],
      });
      const ownerId = graph.person.create({
        confidentialNotes: "owner-only",
        email: "owner@example.com",
        manager: managerId,
        name: "Owner",
        peers: [reviewerId],
        status: resolvedEnumValue(kitchenSink.status.values.inReview),
        worksAt: [companyId],
      });
      const secretId = graph.secret.create({
        fingerprint: "hidden-fingerprint",
        name: "Primary secret",
        version: 3,
      });

      graph.record.create({
        contact: {
          email: "support@example.com",
        },
        details: "Seeded record details",
        headline: "KS-PRIMARY",
        name: "Primary record",
        owner: ownerId,
        reviewers: [reviewerId],
        review: {
          notes: "LGTM",
          reviewer: reviewerId,
        },
        score: 42,
        secret: secretId,
        severity: resolvedEnumValue(kitchenSink.severity.values.high),
        status: resolvedEnumValue(kitchenSink.status.values.inReview),
        tags: [tagId],
      });
    }).store.snapshot();
  }

  const snapshot = kitchenSinkAuthoritySnapshot;
  if (!snapshot) throw new Error("Kitchen sink authority snapshot was not initialized.");
  return createAuthorityFromSnapshot(kitchenSink, snapshot);
}

function createMockFetch(authority: MockAuthority): FetchImpl {
  return async (input, init) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);

    if (url.pathname === "/api/sync") {
      const after = url.searchParams.get("after") ?? undefined;
      const payload: SyncPayload = after
        ? authority.writes.getIncrementalSyncResult(after)
        : createAuthoritativeTotalSyncPayload(authority.store, authority.namespace, {
            cursor: authority.writes.getCursor() ?? authority.writes.getBaseCursor(),
          });
      return Response.json(payload);
    }

    if (url.pathname === "/api/tx" && request.method === "POST") {
      const transaction = (await request.json()) as GraphWriteTransaction;
      const result: AuthoritativeGraphWriteResult = authority.writes.apply(transaction);
      return Response.json(result);
    }

    return Response.json({ error: `Unhandled ${request.method} ${url.pathname}` }, { status: 404 });
  };
}

async function connectClient(server: ReturnType<typeof createGraphMcpServer>) {
  const client = new Client({
    name: "io-mcp-test-client",
    version: "1.0.0",
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

async function callTool(
  client: Client,
  name: string,
  args?: Record<string, unknown>,
): Promise<{
  readonly content: readonly { readonly text?: string; readonly type: string }[];
  readonly isError?: boolean;
  readonly structuredContent?: unknown;
}> {
  const result = await client.callTool(args ? { arguments: args, name } : { name });

  if ("toolResult" in result) {
    throw new Error("Expected a callTool content result.");
  }

  return result;
}

describe("createGraphMcpSession", () => {
  it("reports synced graph status for the product namespace", async () => {
    const authority = createProductAuthority();

    const session = await createGraphMcpSession({
      fetch: createMockFetch(authority),
      url: "http://graph.test",
    });

    const status = session.getStatus();

    expect(status).toMatchObject({
      baseUrl: "http://graph.test/",
      pendingCount: 0,
      ready: true,
      syncStatus: "ready",
    });
    expect(status.cursor).toBeDefined();
    expect(status.lastSyncedAt).toBeDefined();
    expect(status.entityTypeCounts).toEqual(
      expect.arrayContaining([
        { count: 1, name: "document", type: "workflow:document" },
        { count: 0, name: "documentBlock", type: "workflow:documentBlock" },
        { count: 0, name: "documentPlacement", type: "workflow:documentPlacement" },
        { count: 1, name: "envVar", type: "workflow:envVar" },
        { count: 0, name: "project", type: "workflow:project" },
        { count: 0, name: "repository", type: "workflow:repository" },
        { count: 0, name: "branch", type: "workflow:branch" },
        { count: 0, name: "commit", type: "workflow:commit" },
        { count: 0, name: "repositoryBranch", type: "workflow:repositoryBranch" },
        { count: 0, name: "repositoryCommit", type: "workflow:repositoryCommit" },
      ]),
    );
    expect(status.entityTypeCounts).toHaveLength(16);
  });

  it("forwards the bearer token into graph session transport requests", async () => {
    const authority = createProductAuthority();
    const forwardedAuthorization: string[] = [];
    const fetch: FetchImpl = async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      forwardedAuthorization.push(request.headers.get("authorization") ?? "");
      return createMockFetch(authority)(request);
    };

    await createGraphMcpSession({
      bearerToken: "share-token",
      fetch,
      url: "http://graph.test",
    });

    expect(forwardedAuthorization).toEqual(["Bearer share-token"]);
  });
});

describe("createGraphMcpServer", () => {
  it("registers the read-first graph tools", async () => {
    const authority = createProductAuthority();
    const session = await createGraphMcpSession({
      fetch: createMockFetch(authority),
      url: "http://graph.test",
    });
    const server = createGraphMcpServer(session);
    const client = await connectClient(server);

    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual([
        "graph.status",
        "graph.listTypes",
        "graph.listEntities",
        "graph.getEntity",
        "graph.getEntities",
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("registers gated write tools only when enabled", async () => {
    const authority = createProductAuthority();
    const session = await createGraphMcpSession({
      allowWrites: true,
      fetch: createMockFetch(authority),
      url: "http://graph.test",
    });
    const server = createGraphMcpServer(session);
    const client = await connectClient(server);

    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual([
        "graph.status",
        "graph.listTypes",
        "graph.listEntities",
        "graph.getEntity",
        "graph.getEntities",
        "graph.createEntity",
        "graph.updateEntity",
        "graph.deleteEntity",
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns schema summaries and compact entity previews for the workflow namespace", async () => {
    const authority = createProductAuthority();
    const session = await createGraphMcpSession({
      fetch: createMockFetch(authority),
      url: "http://graph.test",
    });
    const server = createGraphMcpServer(session);
    const client = await connectClient(server);

    try {
      const typesResult = await callTool(client, "graph.listTypes");
      expect(typesResult.isError).toBe(false);

      const types = (typesResult.structuredContent as { types: unknown[] }).types as Array<{
        fields?: Array<{ path: string; range: string; writePolicy: string }>;
        kind: string;
        type: string;
      }>;

      expect(types).toContainEqual(
        expect.objectContaining({
          kind: "entity",
          type: "workflow:document",
        }),
      );
      expect(types).toContainEqual(
        expect.objectContaining({
          kind: "enum",
          type: "workflow:documentBlockKind",
        }),
      );

      const documentType = types.find((type) => type.type === "workflow:document");
      expect(documentType?.fields).toContainEqual(
        expect.objectContaining({
          path: "description",
          range: "core:string",
          writePolicy: "client-tx",
        }),
      );

      const entitiesResult = await callTool(client, "graph.listEntities", {
        type: "workflow:document",
      });
      expect(entitiesResult.isError).toBe(false);

      const entities = entitiesResult.structuredContent as {
        entities: Array<{ id: string; preview: Record<string, unknown> }>;
        totalCount: number;
        type: string;
      };
      expect(entities.type).toBe("workflow:document");
      expect(entities.totalCount).toBe(1);
      expect(entities.entities).toHaveLength(1);
      expect(entities.entities[0]?.preview).toMatchObject({
        name: "Graph MCP",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("filters authority-only fields from schema and entity reads", async () => {
    const authority = createKitchenSinkAuthority();
    const session = await createGraphMcpSession({
      fetch: createMockFetch(authority),
      namespace: kitchenSink,
      url: "http://graph.test",
    });
    const server = createGraphMcpServer(session);
    const client = await connectClient(server);

    try {
      const typesResult = await callTool(client, "graph.listTypes");
      const types = (typesResult.structuredContent as { types: unknown[] }).types as Array<{
        fields?: Array<{ path: string }>;
        type: string;
      }>;

      const personType = types.find((type) => type.type === "kitchen:person");
      const secretType = types.find((type) => type.type === "kitchen:secret");

      expect(personType?.fields?.some((field) => field.path === "confidentialNotes")).toBe(false);
      expect(secretType?.fields?.some((field) => field.path === "fingerprint")).toBe(false);

      const owners = await callTool(client, "graph.listEntities", {
        limit: 10,
        type: "kitchen:person",
      });
      const ownerId = (
        owners.structuredContent as {
          entities: Array<{ id: string; preview: Record<string, unknown> }>;
        }
      ).entities.find((entity) => entity.preview.name === "Owner")?.id;

      expect(ownerId).toBeDefined();

      const ownerResult = await callTool(client, "graph.getEntity", {
        id: ownerId,
        type: "kitchen:person",
      });
      expect(ownerResult.isError).toBe(false);

      const owner = (ownerResult.structuredContent as { entity: Record<string, unknown> }).entity;
      expect(owner).toMatchObject({
        email: "owner@example.com",
        id: ownerId,
        name: "Owner",
      });
      expect(owner).not.toHaveProperty("confidentialNotes");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("supports nested select paths and returns structured errors for invalid field paths and ids", async () => {
    const authority = createKitchenSinkAuthority();
    const session = await createGraphMcpSession({
      fetch: createMockFetch(authority),
      namespace: kitchenSink,
      url: "http://graph.test",
    });
    const server = createGraphMcpServer(session);
    const client = await connectClient(server);

    try {
      const records = await callTool(client, "graph.listEntities", {
        limit: 1,
        type: "kitchen:record",
      });
      const recordId = (
        records.structuredContent as {
          entities: Array<{ id: string }>;
        }
      ).entities[0]?.id;

      expect(recordId).toBeDefined();

      const selected = await callTool(client, "graph.getEntity", {
        id: recordId,
        select: [
          "name",
          "owner.id",
          "owner.name",
          "review.reviewer.name",
          "contact.email",
          "secret.version",
        ],
        type: "kitchen:record",
      });
      expect(selected.isError).toBe(false);
      expect(selected.structuredContent).toMatchObject({
        entity: {
          contact: {
            email: "support@example.com",
          },
          id: recordId,
          name: "Primary record",
          owner: {
            name: "Owner",
          },
          review: {
            reviewer: {
              name: "Reviewer",
            },
          },
          secret: {
            version: 3,
          },
        },
        type: "kitchen:record",
      });

      const hiddenField = await callTool(client, "graph.getEntity", {
        id: recordId,
        select: ["owner.confidentialNotes"],
        type: "kitchen:record",
      });
      expect(hiddenField.isError).toBe(true);
      expect(hiddenField.structuredContent).toMatchObject({
        error: {
          code: "graph.invalidFieldPath",
          details: {
            path: "owner.confidentialNotes",
            type: "kitchen:person",
          },
        },
      });

      const missingIds = await callTool(client, "graph.getEntities", {
        ids: [recordId as string, "missing-record"],
        type: "kitchen:record",
      });
      expect(missingIds.isError).toBe(true);
      expect(missingIds.structuredContent).toMatchObject({
        error: {
          code: "graph.missingEntity",
          details: {
            missingIds: ["missing-record"],
            type: "kitchen:record",
          },
        },
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("creates, updates, and deletes entities when writes are explicitly enabled", async () => {
    const authority = createProductAuthority();
    const session = await createGraphMcpSession({
      allowWrites: true,
      fetch: createMockFetch(authority),
      url: "http://graph.test",
    });
    const server = createGraphMcpServer(session);
    const client = await connectClient(server);

    try {
      const created = await callTool(client, "graph.createEntity", {
        type: "workflow:document",
        values: {
          description: "Created through MCP",
          isArchived: false,
          name: "Writable Document",
          slug: "writable-document",
        },
      });
      expect(created.isError).toBe(false);

      const createdEntity = (created.structuredContent as { entity: Record<string, unknown> })
        .entity;
      const createdId = createdEntity.id;

      expect(created.structuredContent).toMatchObject({
        entity: {
          description: "Created through MCP",
          id: expect.any(String),
          isArchived: false,
          name: "Writable Document",
          slug: "writable-document",
        },
        type: "workflow:document",
      });
      expect(typeof createdId).toBe("string");

      const updated = await callTool(client, "graph.updateEntity", {
        id: createdId,
        patch: {
          description: "Updated through MCP",
          name: "Writable Document Updated",
        },
        type: "workflow:document",
      });
      expect(updated.isError).toBe(false);
      expect(updated.structuredContent).toMatchObject({
        entity: {
          description: "Updated through MCP",
          id: createdId,
          name: "Writable Document Updated",
        },
        type: "workflow:document",
      });

      const deleted = await callTool(client, "graph.deleteEntity", {
        id: createdId,
        type: "workflow:document",
      });
      expect(deleted.isError).toBe(false);
      expect(deleted.structuredContent).toEqual({
        deleted: true,
        id: createdId,
        type: "workflow:document",
      });

      const missing = await callTool(client, "graph.getEntity", {
        id: createdId,
        type: "workflow:document",
      });
      expect(missing.isError).toBe(true);
      expect(missing.structuredContent).toMatchObject({
        error: {
          code: "graph.missingEntity",
          details: {
            id: createdId,
            type: "workflow:document",
          },
        },
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("surfaces authority rejection text for secret-backed writes and resets the session state", async () => {
    const authority = createKitchenSinkAuthority();
    const recordId = authority.graph.record.list()[0]?.id;
    if (!recordId) {
      throw new Error("Expected a seeded kitchen sink record.");
    }

    const originalSecretId = authority.graph.record.get(recordId).secret;
    if (!originalSecretId) {
      throw new Error("Expected the seeded record to reference a secret.");
    }

    const replacementSecretId = authority.graph.secret.create({
      fingerprint: "replacement-hidden",
      name: "Replacement secret",
      version: 4,
    });

    const session = await createGraphMcpSession({
      allowWrites: true,
      fetch: createMockFetch(authority),
      namespace: kitchenSink,
      url: "http://graph.test",
    });
    const server = createGraphMcpServer(session);
    const client = await connectClient(server);

    try {
      const failed = await callTool(client, "graph.updateEntity", {
        id: recordId,
        patch: {
          secret: replacementSecretId,
        },
        type: "kitchen:record",
      });
      expect(failed.isError).toBe(true);
      expect(failed.structuredContent).toMatchObject({
        error: {
          code: "graph.writeFailed",
          message:
            'Field "kitchen:record:secret" requires "server-command" writes and cannot be changed through an ordinary transaction.',
        },
      });

      const restored = await callTool(client, "graph.getEntity", {
        id: recordId,
        type: "kitchen:record",
      });
      expect(restored.isError).toBe(false);
      expect(restored.structuredContent).toMatchObject({
        entity: {
          id: recordId,
          secret: originalSecretId,
        },
        type: "kitchen:record",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
