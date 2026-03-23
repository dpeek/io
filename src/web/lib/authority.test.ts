import { describe, expect, it, setDefaultTimeout } from "bun:test";

import {
  createIdMap,
  createStore,
  createSyncedTypeClient,
  createTypeClient,
  defineNamespace,
  defineSecretField,
  defineType,
  edgeId,
  type AnyTypeOutput,
  type AuthSubjectRef,
  type AuthorizationContext,
  type GraphWriteTransaction,
  type StoreSnapshot,
} from "@io/core/graph";
import { core } from "@io/core/graph/modules";
import { ops } from "@io/core/graph/modules/ops";
import { pkm } from "@io/core/graph/modules/pkm";

import {
  createAnonymousAuthorizationContext,
  type SessionPrincipalLookupInput,
} from "./auth-bridge.js";
import {
  createTestWebAppAuthority,
  createTestWebAppAuthorityWithWorkflowFixture,
  executeTestWorkflowMutation as executeWorkflowMutation,
} from "./authority-test-helpers.js";
import { createInMemoryTestWebAppAuthorityStorage } from "./authority-test-storage.js";
import {
  applyStagedWebAuthorityMutation,
  type WebAppAuthority,
  type WebAuthorityCommand,
  type WebAppAuthorityStorage,
  type WebAppAuthoritySyncOptions,
  type WebAppAuthorityTransactionOptions,
} from "./authority.js";
import {
  handleWebCommandRequest,
  handleSyncRequest,
  handleTransactionRequest,
} from "./server-routes.js";

const productGraph = { ...core, ...pkm, ...ops } as const;
const browserGraph = { ...pkm, ...ops } as const;
const envVarDescriptionPredicateId = edgeId(ops.envVar.fields.description);
const envVarSecretPredicateId = edgeId(ops.envVar.fields.secret);
const principalHomeGraphIdPredicateId = edgeId(core.principal.fields.homeGraphId);
const secretHandleVersionPredicateId = edgeId(core.secretHandle.fields.version);
const secretNote = defineType({
  values: { key: "test:secretNote", name: "Secret Note" },
  fields: {
    ...core.node.fields,
    secret: defineSecretField({
      range: core.secretHandle,
      cardinality: "one?",
      meta: {
        label: "Credential",
      },
      revealCapability: "secret:reveal",
      rotateCapability: "secret:rotate",
    }),
  },
});
const secretNoteNamespace = defineNamespace(createIdMap({ secretNote }).map, {
  secretNote,
});
const secretNoteGraph = { ...productGraph, ...secretNoteNamespace } as const;
const secretNoteSecretPredicateId = edgeId(secretNote.fields.secret);

setDefaultTimeout(20_000);

function createTestAuthorizationContext(
  overrides: Partial<AuthorizationContext> = {},
): AuthorizationContext {
  return {
    ...createAnonymousAuthorizationContext({
      graphId: "graph:test",
      policyVersion: 0,
    }),
    ...overrides,
  };
}

function createAuthorityAuthorizationContext(
  overrides: Partial<AuthorizationContext> = {},
): AuthorizationContext {
  return createTestAuthorizationContext({
    principalId: "principal:authority",
    principalKind: "service",
    roleKeys: ["graph:authority"],
    sessionId: "session:authority",
    ...overrides,
  });
}

function createHumanAuthorizationContext(
  overrides: Partial<AuthorizationContext> = {},
): AuthorizationContext {
  return createTestAuthorizationContext({
    principalId: "principal:human",
    principalKind: "human",
    roleKeys: ["graph:member"],
    sessionId: "session:human",
    ...overrides,
  });
}

const workflowModuleScope = {
  kind: "module" as const,
  moduleId: "ops/workflow",
  scopeId: "scope:ops/workflow:review",
};

function updateScopedCursor(cursor: string, updates: Record<string, string>): string {
  if (!cursor.startsWith("scope:")) {
    throw new Error(`Expected a scoped cursor, received "${cursor}".`);
  }

  const params = new URLSearchParams(cursor.slice("scope:".length));
  for (const [key, value] of Object.entries(updates)) {
    params.set(key, value);
  }
  return `scope:${params.toString()}`;
}

function buildGraphWriteTransaction(
  before: StoreSnapshot,
  after: StoreSnapshot,
  id: string,
): GraphWriteTransaction {
  const previousEdgeIds = new Set(before.edges.map((edge) => edge.id));
  const previousRetractedIds = new Set(before.retracted);

  return {
    id,
    ops: [
      ...after.retracted
        .filter((edgeId) => !previousRetractedIds.has(edgeId))
        .map((edgeId) => ({ op: "retract" as const, edgeId })),
      ...after.edges
        .filter((edge) => !previousEdgeIds.has(edge.id))
        .map((edge) => ({
          op: "assert" as const,
          edge: { ...edge },
        })),
    ],
  };
}

function createMutationStoreForGraph<TGraph extends Record<string, AnyTypeOutput>>(
  snapshot: StoreSnapshot,
  graph: TGraph,
) {
  const mutationStore = createStore(snapshot);
  return {
    mutationGraph: createTypeClient(mutationStore, graph),
    mutationStore,
  };
}

function createProductMutationStore(snapshot: StoreSnapshot) {
  return createMutationStoreForGraph(snapshot, productGraph);
}

async function createEnvVar(
  authority: WebAppAuthority,
  authorization: AuthorizationContext,
  input: {
    readonly description: string;
    readonly name: string;
  },
  txId: string,
): Promise<string> {
  const { mutationGraph, mutationStore } = createProductMutationStore(
    authority.readSnapshot({ authorization }),
  );
  const before = mutationStore.snapshot();
  const envVarId = mutationGraph.envVar.create(input);
  const transaction = buildGraphWriteTransaction(before, mutationStore.snapshot(), txId);

  await authority.applyTransaction(transaction, { authorization });
  return envVarId;
}

async function applyServerCommandTransaction(
  authority: WebAppAuthority,
  authorization: AuthorizationContext,
  transaction: GraphWriteTransaction,
): Promise<void> {
  await authority.applyTransaction(transaction, {
    authorization,
    writeScope: "server-command",
  });
}

function buildRetractSecretReferenceTransaction(
  snapshot: StoreSnapshot,
  entityId: string,
  txId: string,
): GraphWriteTransaction {
  const mutationStore = createStore(snapshot);
  const before = mutationStore.snapshot();

  for (const edge of mutationStore.facts(entityId, envVarSecretPredicateId)) {
    mutationStore.retract(edge.id);
  }

  return buildGraphWriteTransaction(before, mutationStore.snapshot(), txId);
}

function readStringPredicateValue(
  authority: WebAppAuthority,
  authorization: AuthorizationContext,
  subjectId: string,
  predicateId: string,
): string | undefined {
  const value = authority.readPredicateValue(subjectId, predicateId, { authorization });
  if (value !== undefined && typeof value !== "string") {
    throw new Error(`Expected predicate "${predicateId}" on "${subjectId}" to decode to a string.`);
  }
  return value;
}

function readNumberPredicateValue(
  authority: WebAppAuthority,
  authorization: AuthorizationContext,
  subjectId: string,
  predicateId: string,
): number | undefined {
  const value = authority.readPredicateValue(subjectId, predicateId, { authorization });
  if (value !== undefined && typeof value !== "number") {
    throw new Error(`Expected predicate "${predicateId}" on "${subjectId}" to decode to a number.`);
  }
  return value;
}

function readProductGraph(authority: WebAppAuthority, authorization: AuthorizationContext) {
  return createProductMutationStore(authority.readSnapshot({ authorization })).mutationGraph;
}

function createSessionPrincipalLookupInput(
  overrides: {
    readonly graphId?: string;
    readonly subject?: Partial<AuthSubjectRef>;
  } = {},
): SessionPrincipalLookupInput {
  return {
    graphId: overrides.graphId ?? "graph:test",
    subject: {
      issuer: "better-auth",
      provider: "user",
      providerAccountId: "user-1",
      authUserId: "auth-user-1",
      ...overrides.subject,
    },
  };
}
describe("web authority", () => {
  it("rolls back staged side effects when staging fails before commit", async () => {
    const secretValuesRef = {
      current: new Map([["secret:existing", "sk-live-first"]]),
    };
    const pendingSecretWriteRef = {
      current: null as {
        readonly secretId: string;
        readonly value: string;
      } | null,
    };
    let commitCalls = 0;

    await expect(
      applyStagedWebAuthorityMutation({
        changed: true,
        result: {
          secretId: "secret:existing",
          secretVersion: 2,
        },
        writeScope: "server-command",
        async commit() {
          commitCalls += 1;
        },
        stage(result, context) {
          const previousSecretValues = secretValuesRef.current;
          context.addRollback(() => {
            secretValuesRef.current = previousSecretValues;
            pendingSecretWriteRef.current = null;
          });

          const nextSecretValues = new Map(previousSecretValues);
          nextSecretValues.set(result.secretId, "sk-live-second");
          secretValuesRef.current = nextSecretValues;
          pendingSecretWriteRef.current = {
            secretId: result.secretId,
            value: "sk-live-second",
          };

          throw new Error("forced staging failure");
        },
      }),
    ).rejects.toThrow("forced staging failure");

    expect(commitCalls).toBe(0);
    expect(secretValuesRef.current).toEqual(new Map([["secret:existing", "sk-live-first"]]));
    expect(pendingSecretWriteRef.current).toBeNull();
  });

  it("allows authority-only commands to reuse the shared authority command seam", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(storage.storage);
    const envVarId = await createEnvVar(
      authority,
      authorization,
      {
        description: "Managed by the authority",
        name: "OPENAI_API_KEY",
      },
      "tx:create-env-var:authority-only-command",
    );
    const { mutationGraph, mutationStore } = createProductMutationStore(
      authority.readSnapshot({ authorization }),
    );
    const before = mutationStore.snapshot();

    mutationGraph.envVar.update(envVarId, {
      description: "Rotated by the authority command",
    });

    const transaction = buildGraphWriteTransaction(
      before,
      mutationStore.snapshot(),
      "tx:authority-only-command",
    );
    const result = await applyStagedWebAuthorityMutation({
      changed: transaction.ops.length > 0,
      result: {
        description: "Rotated by the authority command",
        entityId: envVarId,
      },
      writeScope: "authority-only",
      async commit(writeScope) {
        await authority.applyTransaction(transaction, { authorization, writeScope });
      },
    });

    expect(result).toEqual({
      description: "Rotated by the authority command",
      entityId: envVarId,
    });
    expect(
      readStringPredicateValue(authority, authorization, envVarId, envVarDescriptionPredicateId),
    ).toBe("Rotated by the authority command");
    expect(storage.read()?.writeHistory.results.at(-1)?.writeScope).toBe("authority-only");
  });

  it("stores secret plaintext outside sync and reloads it across restart", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(storage.storage);
    const envVarId = await createEnvVar(
      authority,
      authorization,
      {
        description: "Primary model credential",
        name: "OPENAI_API_KEY",
      },
      "tx:create-env-var:secret-storage",
    );

    const created = await authority.writeSecretField(
      {
        entityId: envVarId,
        predicateId: envVarSecretPredicateId,
        plaintext: "sk-live-first",
      },
      { authorization },
    );
    const createdSecretId = readStringPredicateValue(
      authority,
      authorization,
      envVarId,
      envVarSecretPredicateId,
    );
    if (!createdSecretId) throw new Error("Expected created env var secret.");

    expect(created.created).toBe(true);
    expect(created.rotated).toBe(false);
    expect(created.secretVersion).toBe(1);
    expect(JSON.stringify(authority.createSyncPayload({ authorization }))).not.toContain(
      "sk-live-first",
    );
    expect(storage.read()?.secrets?.[createdSecretId]?.value).toBe("sk-live-first");
    expect(
      storage
        .read()
        ?.writeHistory.results.at(-1)
        ?.txId.startsWith(`secret-field:${envVarId}:${envVarSecretPredicateId}:`),
    ).toBe(true);
    expect(storage.read()?.writeHistory.results.at(-1)?.writeScope).toBe("server-command");

    const rotated = await authority.writeSecretField(
      {
        entityId: envVarId,
        predicateId: envVarSecretPredicateId,
        plaintext: "sk-live-second",
      },
      { authorization },
    );
    const restarted = await createTestWebAppAuthority(storage.storage);
    const restartedSecretId = readStringPredicateValue(
      restarted,
      authorization,
      envVarId,
      envVarSecretPredicateId,
    );
    if (!restartedSecretId) throw new Error("Expected restarted env var secret.");

    expect(rotated.created).toBe(false);
    expect(rotated.rotated).toBe(true);
    expect(rotated.secretVersion).toBe(2);
    expect(storage.read()?.secrets?.[createdSecretId]?.value).toBe("sk-live-second");
    expect(restartedSecretId).toBe(createdSecretId);
    expect(
      readNumberPredicateValue(
        restarted,
        authorization,
        restartedSecretId,
        secretHandleVersionPredicateId,
      ),
    ).toBe(2);
    expect(JSON.stringify(restarted.createSyncPayload({ authorization }))).not.toContain(
      "sk-live-second",
    );

    const confirmed = await restarted.writeSecretField(
      {
        entityId: envVarId,
        predicateId: envVarSecretPredicateId,
        plaintext: "sk-live-second",
      },
      { authorization },
    );

    expect(confirmed).toMatchObject({
      created: false,
      rotated: false,
      secretId: createdSecretId,
      secretVersion: 2,
    });
  });

  it("retains plaintext side rows when a secret-backed reference is retracted", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(storage.storage);
    const envVarId = await createEnvVar(
      authority,
      authorization,
      {
        description: "Primary model credential",
        name: "OPENAI_API_KEY",
      },
      "tx:create-env-var:secret-retract-reference",
    );
    const created = await authority.writeSecretField(
      {
        entityId: envVarId,
        predicateId: envVarSecretPredicateId,
        plaintext: "sk-live-first",
      },
      { authorization },
    );

    const retractTransaction = buildRetractSecretReferenceTransaction(
      authority.readSnapshot({ authorization }),
      envVarId,
      "tx:retract-env-var-secret",
    );

    await applyServerCommandTransaction(authority, authorization, retractTransaction);

    expect(
      readStringPredicateValue(authority, authorization, envVarId, envVarSecretPredicateId),
    ).toBeUndefined();
    expect(storage.read()?.secrets?.[created.secretId]?.value).toBe("sk-live-first");
    expect(JSON.stringify(authority.createSyncPayload({ authorization }))).not.toContain(
      "sk-live-first",
    );

    const restarted = await createTestWebAppAuthority(storage.storage);

    expect(
      readStringPredicateValue(restarted, authorization, envVarId, envVarSecretPredicateId),
    ).toBeUndefined();
    expect(storage.read()?.secrets?.[created.secretId]?.value).toBe("sk-live-first");
    expect(JSON.stringify(restarted.createSyncPayload({ authorization }))).not.toContain(
      "sk-live-first",
    );
  });

  it("retains plaintext side rows when retracting an entity that owns a secret-backed reference", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(storage.storage);
    const envVarId = await createEnvVar(
      authority,
      authorization,
      {
        description: "Primary model credential",
        name: "OPENAI_API_KEY",
      },
      "tx:create-env-var:secret-retract-entity",
    );
    const created = await authority.writeSecretField(
      {
        entityId: envVarId,
        predicateId: envVarSecretPredicateId,
        plaintext: "sk-live-first",
      },
      { authorization },
    );
    const { mutationGraph, mutationStore } = createProductMutationStore(
      authority.readSnapshot({ authorization }),
    );
    const before = mutationStore.snapshot();

    mutationGraph.envVar.delete(envVarId);

    const deleteTransaction = buildGraphWriteTransaction(
      before,
      mutationStore.snapshot(),
      "tx:delete-env-var-with-secret",
    );

    await applyServerCommandTransaction(authority, authorization, deleteTransaction);

    expect(createStore(authority.readSnapshot({ authorization })).facts(envVarId)).toHaveLength(0);
    expect(storage.read()?.secrets?.[created.secretId]?.value).toBe("sk-live-first");
    expect(JSON.stringify(authority.createSyncPayload({ authorization }))).not.toContain(
      "sk-live-first",
    );

    const restarted = await createTestWebAppAuthority(storage.storage);

    expect(createStore(restarted.readSnapshot({ authorization })).facts(envVarId)).toHaveLength(0);
    expect(storage.read()?.secrets?.[created.secretId]?.value).toBe("sk-live-first");
    expect(JSON.stringify(restarted.createSyncPayload({ authorization }))).not.toContain(
      "sk-live-first",
    );
  });

  it("rejects ordinary transactions that directly rewrite secret-backed refs", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(storage.storage);

    const primaryEnvVarId = await createEnvVar(
      authority,
      authorization,
      {
        description: "Primary model credential",
        name: "OPENAI_API_KEY",
      },
      "tx:create-env-var:primary",
    );
    const secondaryEnvVarId = await createEnvVar(
      authority,
      authorization,
      {
        description: "Notifications integration",
        name: "SLACK_BOT_TOKEN",
      },
      "tx:create-env-var:secondary",
    );

    await authority.writeSecretField(
      {
        entityId: primaryEnvVarId,
        predicateId: envVarSecretPredicateId,
        plaintext: "sk-live-first",
      },
      { authorization },
    );
    await authority.writeSecretField(
      {
        entityId: secondaryEnvVarId,
        predicateId: envVarSecretPredicateId,
        plaintext: "xapp-secret",
      },
      { authorization },
    );

    const primarySecretId = readStringPredicateValue(
      authority,
      authorization,
      primaryEnvVarId,
      envVarSecretPredicateId,
    );
    const secondarySecretId = readStringPredicateValue(
      authority,
      authorization,
      secondaryEnvVarId,
      envVarSecretPredicateId,
    );
    if (!primarySecretId || !secondarySecretId) {
      throw new Error("Expected both env vars to reference secrets.");
    }

    const { mutationGraph, mutationStore } = createProductMutationStore(
      authority.readSnapshot({ authorization }),
    );
    const before = mutationStore.snapshot();

    mutationGraph.envVar.update(primaryEnvVarId, {
      secret: secondarySecretId,
    });

    const transaction = buildGraphWriteTransaction(
      before,
      mutationStore.snapshot(),
      "tx:direct-secret",
    );

    await expect(authority.applyTransaction(transaction, { authorization })).rejects.toMatchObject({
      result: expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: "policy.write.forbidden",
            message: expect.stringContaining('requires "server-command" writes'),
          }),
        ]),
      }),
    });
    expect(
      readStringPredicateValue(authority, authorization, primaryEnvVarId, envVarSecretPredicateId),
    ).toBe(primarySecretId);
  });

  it("rolls back staged secret state when a server-command commit fails", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const backingStorage = createInMemoryTestWebAppAuthorityStorage();
    let failServerCommandCommit = false;
    const storage = {
      load() {
        return backingStorage.storage.load();
      },
      loadSecrets() {
        return backingStorage.storage.loadSecrets();
      },
      async commit(input, options) {
        if (failServerCommandCommit) {
          throw new Error("forced server-command commit failure");
        }
        await backingStorage.storage.commit(input, options);
      },
      persist(input) {
        return backingStorage.storage.persist(input);
      },
    } satisfies WebAppAuthorityStorage;
    const authority = await createTestWebAppAuthority(storage);
    const envVarId = await createEnvVar(
      authority,
      authorization,
      {
        description: "Primary model credential",
        name: "OPENAI_API_KEY",
      },
      "tx:create-env-var:server-command-rollback",
    );

    const created = await authority.writeSecretField(
      {
        entityId: envVarId,
        predicateId: envVarSecretPredicateId,
        plaintext: "sk-live-first",
      },
      { authorization },
    );

    failServerCommandCommit = true;

    await expect(
      authority.writeSecretField(
        {
          entityId: envVarId,
          predicateId: envVarSecretPredicateId,
          plaintext: "sk-live-second",
        },
        { authorization },
      ),
    ).rejects.toThrow("forced server-command commit failure");

    expect(backingStorage.read()?.secrets?.[created.secretId]?.value).toBe("sk-live-first");
    expect(
      readNumberPredicateValue(
        authority,
        authorization,
        created.secretId,
        secretHandleVersionPredicateId,
      ),
    ).toBe(1);

    failServerCommandCommit = false;

    const retried = await authority.writeSecretField(
      {
        entityId: envVarId,
        predicateId: envVarSecretPredicateId,
        plaintext: "sk-live-second",
      },
      { authorization },
    );

    expect(created).toMatchObject({
      created: true,
      rotated: false,
      secretVersion: 1,
    });
    expect(retried).toMatchObject({
      created: false,
      rotated: true,
      secretId: created.secretId,
      secretVersion: 2,
    });
    expect(backingStorage.read()?.secrets?.[created.secretId]?.value).toBe("sk-live-second");
    expect(
      readNumberPredicateValue(
        authority,
        authorization,
        created.secretId,
        secretHandleVersionPredicateId,
      ),
    ).toBe(2);
    expect(backingStorage.read()?.writeHistory.results.at(-1)?.writeScope).toBe("server-command");
  });

  it("routes generic secret-field writes through the web server helper", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(storage.storage);
    const envVarId = await createEnvVar(
      authority,
      authorization,
      {
        description: "Shared command credential",
        name: "OPENAI_API_KEY",
      },
      "tx:create-env-var:generic-command",
    );
    const command = {
      kind: "write-secret-field",
      input: {
        entityId: envVarId,
        predicateId: envVarSecretPredicateId,
        plaintext: "sk-live-command",
      },
    } satisfies WebAuthorityCommand;

    const result = await authority.executeCommand(command, { authorization });

    expect(result).toMatchObject({
      created: true,
      entityId: envVarId,
      predicateId: envVarSecretPredicateId,
      rotated: false,
      secretVersion: 1,
    });
    expect(
      readStringPredicateValue(authority, authorization, envVarId, envVarSecretPredicateId),
    ).toBe(result.secretId);
    expect(storage.read()?.writeHistory.results.at(-1)?.writeScope).toBe("server-command");
    expect(JSON.stringify(authority.createSyncPayload({ authorization }))).not.toContain(
      "sk-live-command",
    );
  });

  it("accepts secret-field commands for non-env-var secret-backed predicates", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(storage.storage, {
      graph: secretNoteGraph,
    });
    const { mutationGraph, mutationStore } = createMutationStoreForGraph(
      authority.readSnapshot({ authorization }),
      secretNoteGraph,
    );
    const before = mutationStore.snapshot();
    const secretNoteId = mutationGraph.secretNote.create({
      name: "Shared command note",
    });
    const transaction = buildGraphWriteTransaction(
      before,
      mutationStore.snapshot(),
      "tx:create-secret-note",
    );

    await authority.applyTransaction(transaction, { authorization });

    const result = await authority.executeCommand(
      {
        kind: "write-secret-field",
        input: {
          entityId: secretNoteId,
          predicateId: secretNoteSecretPredicateId,
          plaintext: "shared-note-secret",
        },
      },
      { authorization },
    );

    expect(result).toMatchObject({
      created: true,
      entityId: secretNoteId,
      predicateId: secretNoteSecretPredicateId,
      rotated: false,
      secretVersion: 1,
    });
    expect(
      readStringPredicateValue(authority, authorization, secretNoteId, secretNoteSecretPredicateId),
    ).toBe(result.secretId);
    expect(storage.read()?.writeHistory.results.at(-1)?.writeScope).toBe("server-command");
    expect(JSON.stringify(authority.createSyncPayload({ authorization }))).not.toContain(
      "shared-note-secret",
    );
  });

  it("rejects unsupported command kinds before mutating the web authority", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(storage.storage);
    const before = authority.readSnapshot({ authorization });

    await expect(
      authority.executeCommand(
        {
          kind: "unsupported-web-proof",
        } as unknown as WebAuthorityCommand,
        { authorization },
      ),
    ).rejects.toThrow("Unsupported web authority command.");

    expect(authority.readSnapshot({ authorization })).toEqual(before);
  });

  it("routes shared authority commands through the web server helper", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(storage.storage);
    const envVarId = await createEnvVar(
      authority,
      authorization,
      {
        description: "Shared command route credential",
        name: "OPENAI_API_KEY",
      },
      "tx:create-env-var:command-route",
    );

    const response = await handleWebCommandRequest(
      new Request("http://web.local/api/commands", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          kind: "write-secret-field",
          input: {
            entityId: envVarId,
            predicateId: envVarSecretPredicateId,
            plaintext: "sk-live-command-route",
          },
        } satisfies WebAuthorityCommand),
      }),
      authority,
      authorization,
    );
    const payload = (await response.json()) as {
      readonly created: boolean;
      readonly entityId: string;
      readonly predicateId: string;
      readonly rotated: boolean;
      readonly secretId: string;
      readonly secretVersion: number;
    };

    expect(response.status).toBe(201);
    expect(payload).toMatchObject({
      created: true,
      entityId: envVarId,
      predicateId: envVarSecretPredicateId,
      rotated: false,
      secretVersion: 1,
    });
    expect(
      readStringPredicateValue(authority, authorization, envVarId, envVarSecretPredicateId),
    ).toBe(payload.secretId);
    expect(storage.read()?.writeHistory.results.at(-1)?.writeScope).toBe("server-command");
    expect(JSON.stringify(authority.createSyncPayload({ authorization }))).not.toContain(
      "sk-live-command-route",
    );
  });

  it("keeps graph-owned identity entities out of non-authority snapshot reads", async () => {
    const authorityAuthorization = createAuthorityAuthorizationContext();
    const humanAuthorization = createHumanAuthorizationContext();
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(storage.storage);
    const { mutationGraph, mutationStore } = createProductMutationStore(
      authority.readSnapshot({ authorization: authorityAuthorization }),
    );
    const before = mutationStore.snapshot();
    const principalId = mutationGraph.principal.create({
      homeGraphId: "graph:global",
      kind: core.principalKind.values.human.id,
      name: "Direct Read Principal",
      status: core.principalStatus.values.active.id,
    });
    const transaction = buildGraphWriteTransaction(
      before,
      mutationStore.snapshot(),
      "tx:create-principal:direct-read-contract",
    );

    await authority.applyTransaction(transaction, {
      authorization: authorityAuthorization,
      writeScope: "authority-only",
    });

    const authoritySnapshot = authority.readSnapshot({ authorization: authorityAuthorization });
    const humanSnapshot = authority.readSnapshot({ authorization: humanAuthorization });

    expect(
      authoritySnapshot.edges.some(
        (edge) =>
          edge.s === principalId &&
          edge.p === principalHomeGraphIdPredicateId &&
          edge.o === "graph:global",
      ),
    ).toBe(true);
    expect(humanSnapshot.edges.some((edge) => edge.s === principalId)).toBe(false);
    expect(
      readStringPredicateValue(
        authority,
        authorityAuthorization,
        principalId,
        principalHomeGraphIdPredicateId,
      ),
    ).toBe("graph:global");

    try {
      authority.readPredicateValue(principalId, principalHomeGraphIdPredicateId, {
        authorization: humanAuthorization,
      });
      throw new Error("Expected direct protected reads to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        code: "policy.read.forbidden",
        message: expect.stringContaining("policy.read.forbidden"),
        status: 403,
      });
    }
  });

  it("keeps first-use auth identity records out of signed-in browser sync bootstrap", async () => {
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(storage.storage);
    const lookupInput = createSessionPrincipalLookupInput();
    const projection = await authority.lookupSessionPrincipal(lookupInput);
    const signedInAuthorization = createTestAuthorizationContext({
      graphId: lookupInput.graphId,
      principalId: projection.principalId,
      principalKind: projection.principalKind,
      sessionId: "session:browser",
      roleKeys: [...(projection.roleKeys ?? [])],
      capabilityGrantIds: [...(projection.capabilityGrantIds ?? [])],
      capabilityVersion: projection.capabilityVersion,
    });

    const total = authority.createSyncPayload({
      authorization: signedInAuthorization,
    });
    const runtime = createSyncedTypeClient(browserGraph, {
      pull(state) {
        return Promise.resolve(
          state.cursor
            ? authority.getIncrementalSyncResult(state.cursor, {
                authorization: signedInAuthorization,
              })
            : authority.createSyncPayload({
                authorization: signedInAuthorization,
              }),
        );
      },
    });

    expect(total.snapshot.edges.some((edge) => edge.s === projection.principalId)).toBe(false);

    const applied = await runtime.sync.sync();

    expect(applied.mode).toBe("total");
    expect(runtime.sync.getState()).toMatchObject({
      status: "ready",
      completeness: "complete",
      freshness: "current",
    });
  });

  it("denies direct transactions without authority access by default", async () => {
    const authorization = createHumanAuthorizationContext();
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(storage.storage);
    const { mutationGraph, mutationStore } = createProductMutationStore(
      authority.readSnapshot({ authorization }),
    );
    const before = mutationStore.snapshot();

    mutationGraph.envVar.create({
      description: "Blocked without authority access",
      name: "OPENAI_API_KEY",
    });

    const transaction = buildGraphWriteTransaction(
      before,
      mutationStore.snapshot(),
      "tx:forbidden",
    );

    await expect(authority.applyTransaction(transaction, { authorization })).rejects.toMatchObject({
      result: expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: "policy.write.forbidden",
            message: expect.stringContaining("policy.write.forbidden"),
          }),
        ]),
      }),
    });
    expect(storage.read()?.writeHistory.results.length ?? 0).toBe(0);
  });

  it("denies authority commands without authority access and surfaces stable vocabulary", async () => {
    const authorization = createHumanAuthorizationContext();
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(storage.storage);
    const envVarId = await createEnvVar(
      authority,
      createAuthorityAuthorizationContext(),
      {
        description: "Shared command credential",
        name: "OPENAI_API_KEY",
      },
      "tx:create-env-var:forbidden-command",
    );
    const writeCountBeforeForbiddenCommand = storage.read()?.writeHistory.results.length ?? 0;

    await expect(
      authority.executeCommand(
        {
          kind: "write-secret-field",
          input: {
            entityId: envVarId,
            predicateId: envVarSecretPredicateId,
            plaintext: "sk-live-command",
          },
        },
        { authorization },
      ),
    ).rejects.toMatchObject({
      code: "policy.command.forbidden",
      message: expect.stringContaining("policy.command.forbidden"),
      status: 403,
    });
    expect(storage.read()?.writeHistory.results.length ?? 0).toBe(writeCountBeforeForbiddenCommand);
  });

  it("rejects stale policy versions before authoritative writes commit", async () => {
    const authorization = createAuthorityAuthorizationContext({
      policyVersion: 1,
    });
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(storage.storage);
    const { mutationGraph, mutationStore } = createProductMutationStore(
      authority.readSnapshot({
        authorization: createAuthorityAuthorizationContext(),
      }),
    );
    const before = mutationStore.snapshot();

    mutationGraph.envVar.create({
      description: "Blocked by stale policy version",
      name: "OPENAI_API_KEY",
    });

    const transaction = buildGraphWriteTransaction(
      before,
      mutationStore.snapshot(),
      "tx:stale-policy",
    );

    await expect(authority.applyTransaction(transaction, { authorization })).rejects.toMatchObject({
      result: expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: "policy.stale_context",
            message: expect.stringContaining("policy.stale_context"),
          }),
        ]),
      }),
    });
    expect(storage.read()?.writeHistory.results.length ?? 0).toBe(0);
  });

  it("creates workflow entities through the shared workflow mutation command", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(storage.storage);

    const project = await executeWorkflowMutation(authority, authorization, {
      action: "createProject",
      title: "IO",
      projectKey: "project:io",
    });
    const repository = await executeWorkflowMutation(authority, authorization, {
      action: "createRepository",
      projectId: project.summary.id,
      title: "io",
      repositoryKey: "repo:io",
      repoRoot: "/tmp/io",
      defaultBaseBranch: "main",
    });
    const branch = await executeWorkflowMutation(authority, authorization, {
      action: "createBranch",
      projectId: project.summary.id,
      title: "Workflow authority",
      branchKey: "branch:workflow-authority",
      goalSummary: "Implement workflow mutation commands",
      state: "ready",
    });

    expect(project).toMatchObject({
      action: "createProject",
      created: true,
      summary: {
        entity: "project",
        projectKey: "project:io",
        title: "IO",
      },
    });
    expect(repository).toMatchObject({
      action: "createRepository",
      created: true,
      summary: {
        entity: "repository",
        repositoryKey: "repo:io",
        projectId: project.summary.id,
      },
    });
    expect(branch).toMatchObject({
      action: "createBranch",
      created: true,
      summary: {
        entity: "branch",
        branchKey: "branch:workflow-authority",
        projectId: project.summary.id,
        state: "ready",
      },
    });
    expect(storage.read()?.writeHistory.results.at(-1)?.writeScope).toBe("server-command");
  });

  it("enforces the v1 inferred-project and attached-repository limits", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const authority = await createTestWebAppAuthority(
      createInMemoryTestWebAppAuthorityStorage().storage,
    );
    const project = await executeWorkflowMutation(authority, authorization, {
      action: "createProject",
      title: "IO",
      projectKey: "project:io",
    });
    await executeWorkflowMutation(authority, authorization, {
      action: "createRepository",
      projectId: project.summary.id,
      title: "io",
      repositoryKey: "repo:io",
      repoRoot: "/tmp/io",
      defaultBaseBranch: "main",
    });

    await expect(
      executeWorkflowMutation(authority, authorization, {
        action: "createProject",
        title: "Second inferred project",
        projectKey: "project:io-2",
      }),
    ).rejects.toMatchObject({
      code: "invalid-transition",
      message: "Branch 6 v1 supports exactly one inferred workflow project per graph.",
      status: 409,
    });

    await expect(
      executeWorkflowMutation(authority, authorization, {
        action: "createRepository",
        projectId: project.summary.id,
        title: "io-2",
        repositoryKey: "repo:io-2",
        repoRoot: "/tmp/io-2",
        defaultBaseBranch: "main",
      }),
    ).rejects.toMatchObject({
      code: "invalid-transition",
      message: "Branch 6 v1 supports exactly one attached workflow repository per graph.",
      status: 409,
    });
  });

  it("rejects commit activation when the branch has no repository mapping", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const authority = await createTestWebAppAuthority(
      createInMemoryTestWebAppAuthorityStorage().storage,
    );
    const project = await executeWorkflowMutation(authority, authorization, {
      action: "createProject",
      title: "IO",
      projectKey: "project:io",
    });
    await executeWorkflowMutation(authority, authorization, {
      action: "createRepository",
      projectId: project.summary.id,
      title: "io",
      repositoryKey: "repo:io",
      repoRoot: "/tmp/io",
      defaultBaseBranch: "main",
    });
    const branch = await executeWorkflowMutation(authority, authorization, {
      action: "createBranch",
      projectId: project.summary.id,
      title: "Unmapped branch",
      branchKey: "branch:unmapped",
      goalSummary: "Try to activate without a repository target",
      state: "ready",
    });
    const commit = await executeWorkflowMutation(authority, authorization, {
      action: "createCommit",
      branchId: branch.summary.id,
      title: "Activate me",
      commitKey: "commit:activate-me",
      order: 0,
      state: "ready",
    });

    await expect(
      executeWorkflowMutation(authority, authorization, {
        action: "setCommitState",
        commitId: commit.summary.id,
        state: "active",
      }),
    ).rejects.toMatchObject({
      code: "repository-missing",
      status: 409,
    });
  });

  it("rejects a second active commit on the same branch", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const { authority, fixture } =
      await createTestWebAppAuthorityWithWorkflowFixture(authorization);
    const firstCommit = await executeWorkflowMutation(authority, authorization, {
      action: "createCommit",
      branchId: fixture.branchId,
      title: "First commit",
      commitKey: "commit:first",
      order: 0,
      state: "ready",
    });
    const secondCommit = await executeWorkflowMutation(authority, authorization, {
      action: "createCommit",
      branchId: fixture.branchId,
      title: "Second commit",
      commitKey: "commit:second",
      order: 1,
      state: "ready",
    });

    await executeWorkflowMutation(authority, authorization, {
      action: "setCommitState",
      commitId: firstCommit.summary.id,
      state: "active",
    });

    await expect(
      executeWorkflowMutation(authority, authorization, {
        action: "setCommitState",
        commitId: secondCommit.summary.id,
        state: "active",
      }),
    ).rejects.toMatchObject({
      code: "branch-lock-conflict",
      status: 409,
    });
  });

  it("finalizes repository commits and advances the branch", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const { authority, fixture } =
      await createTestWebAppAuthorityWithWorkflowFixture(authorization);
    const commit = await executeWorkflowMutation(authority, authorization, {
      action: "createCommit",
      branchId: fixture.branchId,
      title: "Finalize me",
      commitKey: "commit:finalize-me",
      order: 0,
      state: "ready",
    });

    await executeWorkflowMutation(authority, authorization, {
      action: "setCommitState",
      commitId: commit.summary.id,
      state: "active",
    });
    const repositoryCommit = await executeWorkflowMutation(authority, authorization, {
      action: "createRepositoryCommit",
      repositoryId: fixture.repositoryId,
      repositoryBranchId: fixture.repositoryBranchId,
      workflowCommitId: commit.summary.id,
      title: "Finalize me",
      state: "attached",
      worktree: {
        path: "/tmp/io-worktree",
        branchName: "workflow-authority",
      },
    });
    const finalized = await executeWorkflowMutation(authority, authorization, {
      action: "attachCommitResult",
      repositoryCommitId: repositoryCommit.summary.id,
      sha: "abc1234",
    });

    expect(finalized).toMatchObject({
      action: "attachCommitResult",
      created: false,
      summary: {
        entity: "repository-commit",
        id: repositoryCommit.summary.id,
        sha: "abc1234",
        state: "committed",
        workflowCommitId: commit.summary.id,
      },
    });
    const persistedGraph = readProductGraph(authority, authorization);

    expect(persistedGraph.workflowCommit.get(commit.summary.id).state).toBe(
      ops.workflowCommitState.values.committed.id,
    );
    expect(persistedGraph.workflowBranch.get(fixture.branchId).state).toBe(
      ops.workflowBranchState.values.done.id,
    );
    expect(persistedGraph.workflowBranch.get(fixture.branchId).activeCommit).toBeUndefined();
    expect(persistedGraph.repositoryCommit.get(repositoryCommit.summary.id).state).toBe(
      ops.repositoryCommitState.values.committed.id,
    );
    expect(
      persistedGraph.repositoryCommit.get(repositoryCommit.summary.id).worktree.leaseState,
    ).toBe(ops.repositoryCommitLeaseState.values.released.id);
  });

  it("plans the first workflow module scope and produces scoped total and incremental payloads", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const { authority, fixture } =
      await createTestWebAppAuthorityWithWorkflowFixture(authorization);
    const envVarId = await createEnvVar(
      authority,
      authorization,
      {
        description: "Out of scope for workflow sync",
        name: "OPENAI_API_KEY",
      },
      "tx:create-env-var:workflow-scope",
    );

    const total = authority.createSyncPayload({
      authorization,
      scope: workflowModuleScope,
    });

    expect(total).toMatchObject({
      mode: "total",
      scope: {
        kind: "module",
        moduleId: workflowModuleScope.moduleId,
        scopeId: workflowModuleScope.scopeId,
        definitionHash: "scope-def:ops/workflow:review:v1",
        policyFilterVersion: "policy:0",
      },
      completeness: "complete",
      freshness: "current",
    });
    expect(total.cursor).toContain("moduleId=ops%2Fworkflow");
    expect(total.snapshot.edges.some((edge) => edge.s === fixture.branchId)).toBe(true);
    expect(total.snapshot.edges.some((edge) => edge.s === envVarId)).toBe(false);

    const createdCommit = await executeWorkflowMutation(authority, authorization, {
      action: "createCommit",
      branchId: fixture.branchId,
      title: "Scoped incremental",
      commitKey: "commit:scoped-incremental",
      order: 0,
      state: "ready",
    });

    const incremental = authority.getIncrementalSyncResult(total.cursor, {
      authorization,
      scope: workflowModuleScope,
    });

    if (incremental.mode !== "incremental" || "fallback" in incremental) {
      throw new Error("Expected a data-bearing scoped incremental sync payload.");
    }
    expect(incremental.scope).toEqual(total.scope);
    expect(incremental.transactions).toHaveLength(1);
    expect(
      incremental.transactions[0]?.transaction.ops.some(
        (operation) =>
          operation.op === "assert" &&
          operation.edge.s === createdCommit.summary.id &&
          operation.edge.p === edgeId(core.node.fields.name),
      ),
    ).toBe(true);
    expect(
      incremental.transactions[0]?.transaction.ops.some(
        (operation) => operation.op === "assert" && operation.edge.s === envVarId,
      ),
    ).toBe(false);
  });

  it("returns explicit scope and policy fallbacks for stale scoped cursors", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const { authority } = await createTestWebAppAuthorityWithWorkflowFixture(authorization);
    const total = authority.createSyncPayload({
      authorization,
      scope: workflowModuleScope,
    });
    const scopeChangedCursor = updateScopedCursor(total.cursor, {
      scopeId: "scope:ops/workflow:backlog",
    });
    const policyChangedCursor = updateScopedCursor(total.cursor, {
      policyFilterVersion: "policy:999",
    });

    const scopeChanged = authority.getIncrementalSyncResult(scopeChangedCursor, {
      authorization,
      scope: workflowModuleScope,
    });
    const policyChanged = authority.getIncrementalSyncResult(policyChangedCursor, {
      authorization,
      scope: workflowModuleScope,
    });

    expect(scopeChanged).toMatchObject({
      mode: "incremental",
      fallback: "scope-changed",
      scope: total.scope,
      after: scopeChangedCursor,
    });
    expect(policyChanged).toMatchObject({
      mode: "incremental",
      fallback: "policy-changed",
      scope: total.scope,
      after: policyChangedCursor,
    });
  });

  it("returns workflow failure codes through the command route", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const authority = await createTestWebAppAuthority(
      createInMemoryTestWebAppAuthorityStorage().storage,
    );
    const project = await executeWorkflowMutation(authority, authorization, {
      action: "createProject",
      title: "IO",
      projectKey: "project:io",
    });
    await executeWorkflowMutation(authority, authorization, {
      action: "createRepository",
      projectId: project.summary.id,
      title: "io",
      repositoryKey: "repo:io",
      repoRoot: "/tmp/io",
      defaultBaseBranch: "main",
    });
    const branch = await executeWorkflowMutation(authority, authorization, {
      action: "createBranch",
      projectId: project.summary.id,
      title: "Route branch",
      branchKey: "branch:route-branch",
      goalSummary: "Exercise route failures",
      state: "ready",
    });
    const commit = await executeWorkflowMutation(authority, authorization, {
      action: "createCommit",
      branchId: branch.summary.id,
      title: "Route commit",
      commitKey: "commit:route-commit",
      order: 0,
      state: "ready",
    });

    const response = await handleWebCommandRequest(
      new Request("http://web.local/api/commands", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          kind: "workflow-mutation",
          input: {
            action: "setCommitState",
            commitId: commit.summary.id,
            state: "active",
          },
        } satisfies WebAuthorityCommand),
      }),
      authority,
      authorization,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "repository-missing",
      error: `Workflow branch "${branch.summary.id}" does not have a managed repository branch target.`,
    });
  });

  it("repairs persisted principals missing homeGraphId during bootstrap", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(storage.storage);
    const { mutationGraph, mutationStore } = createProductMutationStore(
      authority.readSnapshot({ authorization }),
    );
    const before = mutationStore.snapshot();
    const principalId = mutationGraph.principal.create({
      homeGraphId: "graph:global",
      kind: core.principalKind.values.human.id,
      name: "Legacy Principal",
      status: core.principalStatus.values.active.id,
    });

    await authority.applyTransaction(
      buildGraphWriteTransaction(before, mutationStore.snapshot(), "tx:create-legacy-principal"),
      {
        authorization,
        writeScope: "authority-only",
      },
    );

    const persisted = storage.read();
    if (!persisted) {
      throw new Error("Expected a persisted authority snapshot.");
    }

    const legacyState = {
      ...structuredClone(persisted),
      snapshot: {
        ...persisted.snapshot,
        edges: persisted.snapshot.edges.filter(
          (edge) => !(edge.s === principalId && edge.p === principalHomeGraphIdPredicateId),
        ),
      },
    };

    const legacyStorage = createInMemoryTestWebAppAuthorityStorage(legacyState);
    const repaired = await createTestWebAppAuthority(legacyStorage.storage);
    const repairedPrincipal = readProductGraph(repaired, authorization).principal.get(principalId);
    const repairedHomeGraphEdges =
      legacyStorage
        .read()
        ?.snapshot.edges.filter(
          (edge) => edge.s === principalId && edge.p === principalHomeGraphIdPredicateId,
        ) ?? [];

    expect(repairedPrincipal).toMatchObject({
      homeGraphId: "graph:global",
      kind: core.principalKind.values.human.id,
      status: core.principalStatus.values.active.id,
    });
    expect(repairedHomeGraphEdges).toHaveLength(1);
    expect(repairedHomeGraphEdges[0]?.o).toBe("graph:global");
    expect(legacyStorage.read()?.writeHistory.results.at(-1)?.writeScope).toBe("authority-only");
    expect(
      legacyStorage
        .read()
        ?.writeHistory.results.at(-1)
        ?.txId.startsWith("repair:principal-home-graph-id:"),
    ).toBe(true);
  });

  it("resolves graph-owned auth subject projections to principals and active role bindings", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(storage.storage);
    const lookupInput = createSessionPrincipalLookupInput();
    const { mutationGraph, mutationStore } = createProductMutationStore(
      authority.readSnapshot({ authorization }),
    );
    const before = mutationStore.snapshot();
    const principalId = mutationGraph.principal.create({
      homeGraphId: lookupInput.graphId,
      kind: core.principalKind.values.human.id,
      name: "Lookup Principal",
      status: core.principalStatus.values.active.id,
    });

    mutationGraph.authSubjectProjection.create({
      authUserId: lookupInput.subject.authUserId,
      issuer: lookupInput.subject.issuer,
      mirroredAt: new Date("2026-03-24T00:00:00.000Z"),
      name: "Lookup Subject",
      principal: principalId,
      provider: lookupInput.subject.provider,
      providerAccountId: lookupInput.subject.providerAccountId,
      status: core.authSubjectStatus.values.active.id,
    });
    mutationGraph.principalRoleBinding.create({
      name: "Graph Member",
      principal: principalId,
      roleKey: "graph:member",
      status: core.principalRoleBindingStatus.values.active.id,
    });
    mutationGraph.principalRoleBinding.create({
      name: "Revoked Authority",
      principal: principalId,
      roleKey: "graph:authority",
      status: core.principalRoleBindingStatus.values.revoked.id,
    });

    await authority.applyTransaction(
      buildGraphWriteTransaction(before, mutationStore.snapshot(), "tx:create-session-principal"),
      {
        authorization,
        writeScope: "authority-only",
      },
    );

    expect(await authority.lookupSessionPrincipal(lookupInput)).toEqual({
      principalId,
      principalKind: "human",
      roleKeys: ["graph:member"],
      capabilityGrantIds: [],
      capabilityVersion: 0,
    });
  });

  it("creates missing principals and subject projections idempotently on first authenticated use", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(storage.storage);
    const lookupInput = createSessionPrincipalLookupInput();

    const first = await authority.lookupSessionPrincipal(lookupInput);
    const second = await authority.lookupSessionPrincipal(lookupInput);
    const productGraphClient = readProductGraph(authority, authorization);
    const projections = productGraphClient.authSubjectProjection.list();

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      principalKind: "human",
      roleKeys: [],
      capabilityGrantIds: [],
      capabilityVersion: 0,
    });
    expect(productGraphClient.principal.list()).toHaveLength(1);
    expect(projections).toHaveLength(1);
    expect(productGraphClient.principal.get(first.principalId)).toMatchObject({
      homeGraphId: lookupInput.graphId,
      kind: core.principalKind.values.human.id,
      status: core.principalStatus.values.active.id,
    });
    expect(projections[0]).toMatchObject({
      authUserId: lookupInput.subject.authUserId,
      issuer: lookupInput.subject.issuer,
      principal: first.principalId,
      provider: lookupInput.subject.provider,
      providerAccountId: lookupInput.subject.providerAccountId,
      status: core.authSubjectStatus.values.active.id,
    });
  });

  it("repairs missing exact subject projections by linking them to the existing auth-user principal", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(storage.storage);
    const existingInput = createSessionPrincipalLookupInput({
      subject: {
        providerAccountId: "user-1:github",
      },
    });
    const repairedInput = createSessionPrincipalLookupInput();
    const { mutationGraph, mutationStore } = createProductMutationStore(
      authority.readSnapshot({ authorization }),
    );
    const before = mutationStore.snapshot();
    const principalId = mutationGraph.principal.create({
      homeGraphId: existingInput.graphId,
      kind: core.principalKind.values.human.id,
      name: "Existing Principal",
      status: core.principalStatus.values.active.id,
    });

    mutationGraph.authSubjectProjection.create({
      authUserId: existingInput.subject.authUserId,
      issuer: existingInput.subject.issuer,
      mirroredAt: new Date("2026-03-24T00:00:00.000Z"),
      name: "Existing Subject",
      principal: principalId,
      provider: existingInput.subject.provider,
      providerAccountId: existingInput.subject.providerAccountId,
      status: core.authSubjectStatus.values.active.id,
    });

    await authority.applyTransaction(
      buildGraphWriteTransaction(
        before,
        mutationStore.snapshot(),
        "tx:create-existing-auth-user-principal",
      ),
      {
        authorization,
        writeScope: "authority-only",
      },
    );

    const repaired = await authority.lookupSessionPrincipal(repairedInput);
    const repairedProjection = readProductGraph(authority, authorization)
      .authSubjectProjection.list()
      .find(
        (projection) =>
          projection.providerAccountId === repairedInput.subject.providerAccountId &&
          projection.authUserId === repairedInput.subject.authUserId,
      );

    expect(repaired.principalId).toBe(principalId);
    expect(repairedProjection).toMatchObject({
      principal: principalId,
      providerAccountId: repairedInput.subject.providerAccountId,
      status: core.authSubjectStatus.values.active.id,
    });
  });

  it("fails closed when the same auth user is linked to multiple active principals", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(storage.storage);
    const lookupInput = createSessionPrincipalLookupInput({
      subject: {
        providerAccountId: "user-1:slack",
      },
    });
    const { mutationGraph, mutationStore } = createProductMutationStore(
      authority.readSnapshot({ authorization }),
    );
    const before = mutationStore.snapshot();
    const firstPrincipalId = mutationGraph.principal.create({
      homeGraphId: lookupInput.graphId,
      kind: core.principalKind.values.human.id,
      name: "First Principal",
      status: core.principalStatus.values.active.id,
    });
    const secondPrincipalId = mutationGraph.principal.create({
      homeGraphId: lookupInput.graphId,
      kind: core.principalKind.values.human.id,
      name: "Second Principal",
      status: core.principalStatus.values.active.id,
    });

    mutationGraph.authSubjectProjection.create({
      authUserId: lookupInput.subject.authUserId,
      issuer: lookupInput.subject.issuer,
      mirroredAt: new Date("2026-03-24T00:00:00.000Z"),
      name: "First Subject",
      principal: firstPrincipalId,
      provider: lookupInput.subject.provider,
      providerAccountId: "user-1:first",
      status: core.authSubjectStatus.values.active.id,
    });
    mutationGraph.authSubjectProjection.create({
      authUserId: lookupInput.subject.authUserId,
      issuer: lookupInput.subject.issuer,
      mirroredAt: new Date("2026-03-24T00:00:00.000Z"),
      name: "Second Subject",
      principal: secondPrincipalId,
      provider: lookupInput.subject.provider,
      providerAccountId: "user-1:second",
      status: core.authSubjectStatus.values.active.id,
    });

    await authority.applyTransaction(
      buildGraphWriteTransaction(
        before,
        mutationStore.snapshot(),
        "tx:create-conflicting-auth-user-principals",
      ),
      {
        authorization,
        writeScope: "authority-only",
      },
    );

    await expect(authority.lookupSessionPrincipal(lookupInput)).rejects.toMatchObject({
      name: "WebAppAuthoritySessionPrincipalLookupError",
      code: "auth.principal_missing",
      reason: "conflict",
      status: 409,
    });
  });

  it("returns an explicit missing-principal error when repair is disabled", async () => {
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(storage.storage);

    await expect(
      authority.lookupSessionPrincipal(createSessionPrincipalLookupInput(), {
        allowRepair: false,
      }),
    ).rejects.toMatchObject({
      name: "WebAppAuthoritySessionPrincipalLookupError",
      code: "auth.principal_missing",
      reason: "missing",
      status: 404,
    });
  });

  it("passes explicit authorization context through sync and transaction helpers", async () => {
    const authorization = createTestAuthorizationContext({
      principalId: "principal-1",
      principalKind: "human",
      sessionId: "session-1",
    });
    const syncAuthorizations: AuthorizationContext[] = [];
    const transactionAuthorizations: AuthorizationContext[] = [];
    const authority = {
      createSyncPayload(options: WebAppAuthoritySyncOptions) {
        syncAuthorizations.push(options.authorization);
        return {
          mode: "total" as const,
          cursor: "cursor:total",
          snapshot: {
            edges: [],
            retracted: [],
          },
        };
      },
      async applyTransaction(
        _transaction: GraphWriteTransaction,
        options: WebAppAuthorityTransactionOptions,
      ) {
        transactionAuthorizations.push(options.authorization);
        return {
          cursor: "cursor:tx",
          replayed: false,
          txId: "tx:route",
          writeScope: "client-tx" as const,
        };
      },
    } as unknown as WebAppAuthority;

    const syncResponse = handleSyncRequest(
      new Request("http://web.local/api/sync"),
      authority,
      authorization,
    );
    const transactionResponse = await handleTransactionRequest(
      new Request("http://web.local/api/tx", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          id: "tx:route",
          ops: [],
        }),
      }),
      authority,
      authorization,
    );

    expect(syncResponse.status).toBe(200);
    expect(transactionResponse.status).toBe(200);
    expect(syncAuthorizations).toEqual([authorization]);
    expect(transactionAuthorizations).toEqual([authorization]);
  });

  it("passes the requested sync scope through the sync route helper", async () => {
    const authorization = createTestAuthorizationContext();
    const scopes: WebAppAuthoritySyncOptions["scope"][] = [];
    const authority = {
      createSyncPayload(options: WebAppAuthoritySyncOptions) {
        scopes.push(options.scope);
        return {
          mode: "total" as const,
          cursor: "cursor:total",
          snapshot: {
            edges: [],
            retracted: [],
          },
          scope: { kind: "graph" as const },
          completeness: "complete" as const,
          freshness: "current" as const,
        };
      },
    } as unknown as WebAppAuthority;

    const response = handleSyncRequest(
      new Request(
        "http://web.local/api/sync?scopeKind=module&moduleId=ops%2Fworkflow&scopeId=scope%3Aops%2Fworkflow%3Areview",
      ),
      authority,
      authorization,
    );

    expect(response.status).toBe(200);
    expect(scopes).toEqual([workflowModuleScope]);
  });

  it("passes explicit whole-graph sync scope through the sync route helper", async () => {
    const authorization = createTestAuthorizationContext();
    const scopes: WebAppAuthoritySyncOptions["scope"][] = [];
    const authority = {
      createSyncPayload(options: WebAppAuthoritySyncOptions) {
        scopes.push(options.scope);
        return {
          mode: "total" as const,
          cursor: "cursor:total",
          snapshot: {
            edges: [],
            retracted: [],
          },
          scope: { kind: "graph" as const },
          completeness: "complete" as const,
          freshness: "current" as const,
        };
      },
    } as unknown as WebAppAuthority;

    const response = handleSyncRequest(
      new Request("http://web.local/api/sync?scopeKind=graph"),
      authority,
      authorization,
    );

    expect(response.status).toBe(200);
    expect(scopes).toEqual([{ kind: "graph" }]);
  });

  it("rejects incomplete module sync scope requests before dispatch", async () => {
    const authorization = createTestAuthorizationContext();
    const authority = {
      createSyncPayload() {
        throw new Error("Route should reject the request before dispatch.");
      },
    } as unknown as WebAppAuthority;

    const response = handleSyncRequest(
      new Request("http://web.local/api/sync?scopeKind=module&moduleId=ops%2Fworkflow"),
      authority,
      authorization,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Sync scope query parameter "scopeId" is required.',
    });
  });

  it("rejects unsupported /api/commands payloads before dispatching the web proof", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(storage.storage);
    const before = authority.readSnapshot({ authorization });

    const response = await handleWebCommandRequest(
      new Request("http://web.local/api/commands", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          kind: "unsupported-web-proof",
        }),
      }),
      authority,
      authorization,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Request body must be a supported /api/commands payload.",
    });
    expect(authority.readSnapshot({ authorization })).toEqual(before);
  });
});
