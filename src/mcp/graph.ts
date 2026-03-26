import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

import { GraphValidationError, isEntityType, type AnyTypeOutput } from "../graph/index.js";
import { ops } from "../graph/modules/ops.js";
import { pkm } from "../graph/modules/pkm.js";
import {
  GraphSyncWriteError,
  createHttpGraphClient,
  defaultHttpGraphUrl,
  type FetchImpl,
  type SyncedTypeClient,
} from "../graph/runtime/index.js";
import {
  GraphMcpToolError,
  buildSelectionFromPaths,
  createGraphMcpSchema,
  type GraphMcpPublicEntityType,
  type GraphMcpSchema,
} from "./schema.js";

type GraphMcpNamespace = Record<string, AnyTypeOutput>;
type GraphEntityHandle = {
  create(values: unknown): string;
  delete(id: string): void;
  list(): { readonly id: string }[];
  query(query: unknown): Promise<unknown>;
  update(id: string, patch: unknown): unknown;
};
type ListEntitiesInput = {
  readonly limit?: number;
  readonly type: string;
};
type GetEntityInput = {
  readonly id: string;
  readonly select?: readonly string[];
  readonly type: string;
};
type GetEntitiesInput = {
  readonly ids: readonly string[];
  readonly select?: readonly string[];
  readonly type: string;
};
type CreateEntityInput = {
  readonly type: string;
  readonly values: Record<string, unknown>;
};
type UpdateEntityInput = {
  readonly id: string;
  readonly patch: Record<string, unknown>;
  readonly type: string;
};
type DeleteEntityInput = {
  readonly id: string;
  readonly type: string;
};
type StatusEntityTypeEntry = {
  readonly name: string;
  readonly type: Extract<AnyTypeOutput, { kind: "entity" }>;
};
type GraphMcpSessionMetadata = {
  readonly entityTypeEntries: readonly StatusEntityTypeEntry[];
  readonly schema: GraphMcpSchema;
};

const recordInputSchema = z.record(z.string(), z.unknown());

const listEntitiesInputSchema = {
  limit: z.number().int().positive().max(100).optional(),
  type: z.string().min(1),
};

const getEntityInputSchema = {
  id: z.string().min(1),
  select: z.array(z.string().min(1)).max(100).optional(),
  type: z.string().min(1),
};

const getEntitiesInputSchema = {
  ids: z.array(z.string().min(1)).min(1).max(100),
  select: z.array(z.string().min(1)).max(100).optional(),
  type: z.string().min(1),
};

const createEntityInputSchema = {
  type: z.string().min(1),
  values: recordInputSchema,
};

const updateEntityInputSchema = {
  id: z.string().min(1),
  patch: recordInputSchema,
  type: z.string().min(1),
};

const deleteEntityInputSchema = {
  id: z.string().min(1),
  type: z.string().min(1),
};

const graphMcpSessionMetadataCache = new WeakMap<GraphMcpNamespace, GraphMcpSessionMetadata>();

export type GraphEntityTypeCount = {
  readonly count: number;
  readonly name: string;
  readonly type: string;
};

export type GraphStatus = {
  readonly baseUrl: string;
  readonly completeness: "complete" | "incomplete";
  readonly cursor?: string;
  readonly entityTypeCounts: readonly GraphEntityTypeCount[];
  readonly error?: string;
  readonly freshness: "current" | "stale";
  readonly lastSyncedAt?: string;
  readonly pendingCount: number;
  readonly ready: boolean;
  readonly syncStatus: "idle" | "syncing" | "pushing" | "ready" | "error";
};

export type GraphMcpSessionOptions = {
  readonly allowWrites?: boolean;
  readonly bearerToken?: string;
  readonly fetch?: FetchImpl;
  readonly namespace?: GraphMcpNamespace;
  readonly url?: string;
};

export type GraphMcpStartOptions = GraphMcpSessionOptions;

export type GraphMcpSession = {
  readonly allowWrites: boolean;
  readonly baseUrl: string;
  readonly client: SyncedTypeClient<GraphMcpNamespace>;
  readonly schema: GraphMcpSchema;
  getStatus(): GraphStatus;
  reset(): Promise<void>;
  sync(): Promise<void>;
};

const graphNamespace = { ...pkm, ...ops } as const;

function getGraphMcpSessionMetadata(namespace: GraphMcpNamespace): GraphMcpSessionMetadata {
  const cached = graphMcpSessionMetadataCache.get(namespace);
  if (cached) return cached;

  const metadata = {
    entityTypeEntries: Object.entries(namespace)
      .flatMap(([name, type]) => (isEntityType(type) ? [{ name, type }] : []))
      .sort((left, right) => left.type.values.key.localeCompare(right.type.values.key)),
    schema: createGraphMcpSchema(namespace),
  };

  graphMcpSessionMetadataCache.set(namespace, metadata);
  return metadata;
}

function toValidationErrorMessage(error: GraphValidationError<unknown>): string {
  return error.result.issues[0]?.message ?? error.message;
}

function toErrorMessage(error: unknown): string | undefined {
  if (error === undefined) return undefined;
  if (error instanceof GraphValidationError) {
    return toValidationErrorMessage(error);
  }
  if (error instanceof GraphSyncWriteError) {
    return toErrorMessage(error.cause) ?? error.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

function toStructuredGraphStatus(status: GraphStatus): Record<string, unknown> {
  return {
    baseUrl: status.baseUrl,
    completeness: status.completeness,
    cursor: status.cursor,
    entityTypeCounts: status.entityTypeCounts.map((entry) => ({ ...entry })),
    error: status.error,
    freshness: status.freshness,
    lastSyncedAt: status.lastSyncedAt,
    pendingCount: status.pendingCount,
    ready: status.ready,
    syncStatus: status.syncStatus,
  };
}

function createToolResult(structuredContent: Record<string, unknown>, isError = false) {
  return {
    content: [
      {
        text: JSON.stringify(structuredContent, null, 2),
        type: "text" as const,
      },
    ],
    isError,
    structuredContent,
  };
}

function normalizeToolError(
  error: unknown,
  defaultCode = "graph.requestFailed",
  fallbackMessage = "Graph MCP request failed.",
) {
  if (error instanceof GraphMcpToolError) return error;
  if (error instanceof GraphValidationError) {
    return new GraphMcpToolError("graph.invalidInput", toValidationErrorMessage(error), {
      issues: error.result.issues,
    });
  }
  if (error instanceof GraphSyncWriteError) {
    return new GraphMcpToolError(
      "graph.writeFailed",
      toErrorMessage(error.cause) ?? error.message,
      error.cause instanceof GraphValidationError
        ? { issues: error.cause.result.issues }
        : undefined,
    );
  }

  return new GraphMcpToolError(defaultCode, toErrorMessage(error) ?? fallbackMessage);
}

function createToolErrorResult(
  error: unknown,
  defaultCode = "graph.requestFailed",
  fallbackMessage = "Graph MCP request failed.",
) {
  const toolError =
    error instanceof GraphMcpToolError
      ? error
      : normalizeToolError(error, defaultCode, fallbackMessage);

  return createToolResult(
    {
      error: {
        code: toolError.code,
        ...(toolError.details ? { details: toolError.details } : {}),
        message: toolError.message,
      },
    },
    true,
  );
}

function readEntityTypeCounts(
  client: SyncedTypeClient<GraphMcpNamespace>,
  entityTypeEntries: readonly StatusEntityTypeEntry[],
): GraphEntityTypeCount[] {
  const graph = client.graph as Record<string, { list(): { readonly id: string }[] }>;
  return entityTypeEntries.map(({ name, type }) => ({
    count: graph[name]?.list().length ?? 0,
    name,
    type: type.values.key,
  }));
}

function readStatus(
  baseUrl: string,
  client: SyncedTypeClient<GraphMcpNamespace>,
  entityTypeEntries: readonly StatusEntityTypeEntry[],
): GraphStatus {
  const state = client.sync.getState();
  return {
    baseUrl,
    completeness: state.completeness,
    cursor: state.cursor,
    entityTypeCounts: readEntityTypeCounts(client, entityTypeEntries),
    error: toErrorMessage(state.error),
    freshness: state.freshness,
    lastSyncedAt: state.lastSyncedAt?.toISOString(),
    pendingCount: state.pendingCount,
    ready: state.status === "ready" && state.error === undefined,
    syncStatus: state.status,
  };
}

function resolveEntityTypeHandle(
  session: GraphMcpSession,
  typeKey: string,
): {
  entry: GraphMcpPublicEntityType;
  handle: GraphEntityHandle;
} {
  const entry = session.schema.publicEntityTypesByKey.get(typeKey);
  if (!entry) {
    const resolvedType = session.schema.typeByRef.get(typeKey);
    if (resolvedType) {
      if (typeKey !== resolvedType.values.key) {
        throw new GraphMcpToolError(
          "graph.invalidType",
          `Graph MCP expects the type key "${resolvedType.values.key}", not the opaque id "${typeKey}".`,
          {
            expectedType: resolvedType.values.key,
            type: typeKey,
          },
        );
      }

      if (!isEntityType(resolvedType)) {
        throw new GraphMcpToolError(
          "graph.invalidType",
          `Type "${typeKey}" is not an entity type.`,
          {
            type: typeKey,
          },
        );
      }

      throw new GraphMcpToolError(
        "graph.invalidType",
        `Entity type "${typeKey}" is not exposed by graph MCP.`,
        {
          type: typeKey,
        },
      );
    }

    throw new GraphMcpToolError("graph.invalidType", `Unknown graph type "${typeKey}".`, {
      type: typeKey,
    });
  }

  const handle = (session.client.graph as Record<string, GraphEntityHandle | undefined>)[
    entry.alias
  ];
  if (!handle) {
    throw new GraphMcpToolError(
      "graph.invalidType",
      `Missing graph handle for entity type "${entry.typeKey}".`,
      {
        type: entry.typeKey,
      },
    );
  }

  return { entry, handle };
}

function resolveEntitySelection(
  session: GraphMcpSession,
  entry: GraphMcpPublicEntityType,
  select?: readonly string[],
): Record<string, unknown> {
  if (!select || select.length === 0) return entry.defaultSelection;
  return buildSelectionFromPaths(entry.type, session.schema.typeByRef, select);
}

async function queryEntity(
  handle: GraphEntityHandle,
  selection: Record<string, unknown>,
  id: string,
): Promise<Record<string, unknown> | undefined> {
  return (await handle.query({
    select: selection,
    where: { id },
  })) as Record<string, unknown> | undefined;
}

function toPreviewEntity(entity: Record<string, unknown>) {
  const { id, ...preview } = entity;
  return {
    id: typeof id === "string" ? id : String(id),
    preview,
  };
}

async function ensureSynced(session: GraphMcpSession): Promise<void> {
  try {
    await session.sync();
  } catch (error) {
    throw new GraphMcpToolError("graph.syncFailed", toErrorMessage(error) ?? "Graph sync failed.", {
      baseUrl: session.baseUrl,
    });
  }
}

async function assertEntityExists(
  handle: GraphEntityHandle,
  entry: GraphMcpPublicEntityType,
  id: string,
): Promise<void> {
  const entity = (await handle.query({
    select: { id: true },
    where: { id },
  })) as { readonly id: string } | undefined;

  if (entity) return;

  throw new GraphMcpToolError(
    "graph.missingEntity",
    `Missing entity "${id}" for type "${entry.typeKey}".`,
    {
      id,
      type: entry.typeKey,
    },
  );
}

async function assertEntitiesExist(
  handle: GraphEntityHandle,
  entry: GraphMcpPublicEntityType,
  ids: readonly string[],
): Promise<void> {
  const entities = (await handle.query({
    select: { id: true },
    where: { ids },
  })) as readonly { readonly id: string }[];
  const found = new Set(entities.map((entity) => entity.id));
  const missingIds = [...new Set(ids.filter((id) => !found.has(id)))];

  if (missingIds.length === 0) return;

  throw new GraphMcpToolError(
    "graph.missingEntity",
    missingIds.length === 1
      ? `Missing entity "${missingIds[0]}" for type "${entry.typeKey}".`
      : `Missing ${missingIds.length} entities for type "${entry.typeKey}".`,
    {
      missingIds,
      type: entry.typeKey,
    },
  );
}

export function normalizeGraphMcpUrl(url: string): string {
  try {
    return new URL(url).toString();
  } catch {
    throw new Error(`Invalid graph MCP url: ${url}`);
  }
}

export async function createGraphMcpSession(
  options: GraphMcpSessionOptions = {},
): Promise<GraphMcpSession> {
  const namespace = options.namespace ?? graphNamespace;
  const baseUrl = normalizeGraphMcpUrl(options.url ?? defaultHttpGraphUrl);
  const allowWrites = options.allowWrites ?? false;
  const { entityTypeEntries, schema } = getGraphMcpSessionMetadata(namespace);
  const createClient = async () =>
    (await createHttpGraphClient(namespace, {
      bearerToken: options.bearerToken,
      fetch: options.fetch,
      url: baseUrl,
    })) as SyncedTypeClient<GraphMcpNamespace>;
  let client = await createClient();

  return {
    allowWrites,
    baseUrl,
    get client() {
      return client;
    },
    schema,
    getStatus() {
      return readStatus(baseUrl, client, entityTypeEntries);
    },
    async reset() {
      client = await createClient();
    },
    async sync() {
      await client.sync.sync();
    },
  };
}

async function flushSessionWrites(session: GraphMcpSession): Promise<void> {
  try {
    await session.client.sync.flush();
  } catch (error) {
    if (error instanceof GraphSyncWriteError) {
      try {
        await session.reset();
      } catch (resetError) {
        throw new GraphMcpToolError(
          "graph.writeFailed",
          toErrorMessage(error.cause) ?? error.message,
          {
            recoveryError: toErrorMessage(resetError),
          },
        );
      }
    }

    throw error;
  }
}

export function createGraphMcpServer(session: GraphMcpSession): McpServer {
  const server = new McpServer({
    name: "io-graph",
    version: "1.0.0",
  });

  server.registerTool(
    "graph.status",
    {
      annotations: {
        idempotentHint: true,
        readOnlyHint: true,
      },
      description: "Return the current Worker-backed graph sync state and entity counts.",
      title: "Graph Status",
    },
    async () => {
      try {
        await session.sync();
        return createToolResult(toStructuredGraphStatus(session.getStatus()));
      } catch (error) {
        const status = session.getStatus();
        return createToolResult(
          toStructuredGraphStatus({
            ...status,
            error: toErrorMessage(error) ?? status.error,
            ready: false,
            syncStatus: "error",
          }),
          true,
        );
      }
    },
  );

  server.registerTool(
    "graph.listTypes",
    {
      annotations: {
        idempotentHint: true,
        readOnlyHint: true,
      },
      description: "Return the public graph schema summary for discovery.",
      title: "List Graph Types",
    },
    async () =>
      createToolResult({
        types: session.schema.publicTypeSummaries,
      }),
  );

  server.registerTool(
    "graph.listEntities",
    {
      annotations: {
        idempotentHint: true,
        readOnlyHint: true,
      },
      description: "Return ids and compact previews for one graph entity type.",
      inputSchema: listEntitiesInputSchema as any,
      title: "List Graph Entities",
    },
    async ({ limit, type }: ListEntitiesInput) => {
      try {
        await ensureSynced(session);
        const { entry, handle } = resolveEntityTypeHandle(session, type);
        const allIds = (
          (await handle.query({
            select: { id: true },
          })) as readonly { readonly id: string }[]
        ).map((entity) => entity.id);
        const previewIds = allIds.slice(0, limit ?? 20);
        const previews =
          previewIds.length === 0
            ? []
            : ((await handle.query({
                select: entry.previewSelection,
                where: { ids: previewIds },
              })) as readonly Record<string, unknown>[]);

        return createToolResult({
          entities: previews.map((entity) => toPreviewEntity(entity)),
          totalCount: allIds.length,
          type: entry.typeKey,
        });
      } catch (error) {
        return createToolErrorResult(error);
      }
    },
  );

  server.registerTool(
    "graph.getEntity",
    {
      annotations: {
        idempotentHint: true,
        readOnlyHint: true,
      },
      description: "Return one entity by type and id, with optional selected fields.",
      inputSchema: getEntityInputSchema as any,
      title: "Get Graph Entity",
    },
    async ({ id, select, type }: GetEntityInput) => {
      try {
        await ensureSynced(session);
        const { entry, handle } = resolveEntityTypeHandle(session, type);
        const selection = resolveEntitySelection(session, entry, select);

        await assertEntityExists(handle, entry, id);

        const entity = (await handle.query({
          select: selection,
          where: { id },
        })) as Record<string, unknown> | undefined;

        if (!entity) {
          throw new GraphMcpToolError(
            "graph.missingEntity",
            `Missing entity "${id}" for type "${entry.typeKey}".`,
            {
              id,
              type: entry.typeKey,
            },
          );
        }

        return createToolResult({
          entity,
          type: entry.typeKey,
        });
      } catch (error) {
        return createToolErrorResult(error);
      }
    },
  );

  server.registerTool(
    "graph.getEntities",
    {
      annotations: {
        idempotentHint: true,
        readOnlyHint: true,
      },
      description: "Return a batch of entities by type and ids, with optional selected fields.",
      inputSchema: getEntitiesInputSchema as any,
      title: "Get Graph Entities",
    },
    async ({ ids, select, type }: GetEntitiesInput) => {
      try {
        await ensureSynced(session);
        const { entry, handle } = resolveEntityTypeHandle(session, type);
        const selection = resolveEntitySelection(session, entry, select);

        await assertEntitiesExist(handle, entry, ids);

        const entities = (await handle.query({
          select: selection,
          where: { ids },
        })) as readonly Record<string, unknown>[];

        return createToolResult({
          entities,
          type: entry.typeKey,
        });
      } catch (error) {
        return createToolErrorResult(error);
      }
    },
  );

  if (!session.allowWrites) {
    return server;
  }

  server.registerTool(
    "graph.createEntity",
    {
      description: "Create one graph entity and flush the write through authority.",
      inputSchema: createEntityInputSchema as any,
      title: "Create Graph Entity",
    },
    async ({ type, values }: CreateEntityInput) => {
      try {
        await ensureSynced(session);
        const { entry, handle } = resolveEntityTypeHandle(session, type);
        const id = handle.create(values);
        await flushSessionWrites(session);
        const entity = await queryEntity(handle, entry.defaultSelection, id);

        if (!entity) {
          throw new GraphMcpToolError(
            "graph.missingEntity",
            `Missing entity "${id}" for type "${entry.typeKey}".`,
            {
              id,
              type: entry.typeKey,
            },
          );
        }

        return createToolResult({
          entity,
          type: entry.typeKey,
        });
      } catch (error) {
        return createToolErrorResult(error, "graph.writeFailed", "Graph write failed.");
      }
    },
  );

  server.registerTool(
    "graph.updateEntity",
    {
      description: "Update one graph entity and flush the write through authority.",
      inputSchema: updateEntityInputSchema as any,
      title: "Update Graph Entity",
    },
    async ({ id, patch, type }: UpdateEntityInput) => {
      try {
        await ensureSynced(session);
        const { entry, handle } = resolveEntityTypeHandle(session, type);
        await assertEntityExists(handle, entry, id);
        handle.update(id, patch);
        await flushSessionWrites(session);
        const entity = await queryEntity(handle, entry.defaultSelection, id);

        if (!entity) {
          throw new GraphMcpToolError(
            "graph.missingEntity",
            `Missing entity "${id}" for type "${entry.typeKey}".`,
            {
              id,
              type: entry.typeKey,
            },
          );
        }

        return createToolResult({
          entity,
          type: entry.typeKey,
        });
      } catch (error) {
        return createToolErrorResult(error, "graph.writeFailed", "Graph write failed.");
      }
    },
  );

  server.registerTool(
    "graph.deleteEntity",
    {
      description: "Delete one graph entity and flush the write through authority.",
      inputSchema: deleteEntityInputSchema as any,
      title: "Delete Graph Entity",
    },
    async ({ id, type }: DeleteEntityInput) => {
      try {
        await ensureSynced(session);
        const { entry, handle } = resolveEntityTypeHandle(session, type);
        await assertEntityExists(handle, entry, id);
        handle.delete(id);
        await flushSessionWrites(session);

        return createToolResult({
          deleted: true,
          id,
          type: entry.typeKey,
        });
      } catch (error) {
        return createToolErrorResult(error, "graph.writeFailed", "Graph write failed.");
      }
    },
  );

  return server;
}

export async function startGraphMcpServer(options: GraphMcpStartOptions = {}) {
  const session = await createGraphMcpSession(options);
  const server = createGraphMcpServer(session);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return { server, session, transport };
}
