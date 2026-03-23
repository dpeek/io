import { describe, expect, it, setDefaultTimeout } from "bun:test";

import {
  createStore,
  createTypeClient,
  edgeId,
  type AuthorizationContext,
  type GraphWriteTransaction,
  type StoreSnapshot,
} from "@io/core/graph";
import { core } from "@io/core/graph/modules";
import { ops } from "@io/core/graph/modules/ops";
import { pkm } from "@io/core/graph/modules/pkm";

import { createAnonymousAuthorizationContext } from "./auth-bridge.js";
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
const envVarDescriptionPredicateId = edgeId(ops.envVar.fields.description);
const envVarSecretPredicateId = edgeId(ops.envVar.fields.secret);
const principalHomeGraphIdPredicateId = edgeId(core.principal.fields.homeGraphId);
const secretHandleVersionPredicateId = edgeId(core.secretHandle.fields.version);

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

function createProductMutationStore(snapshot: StoreSnapshot) {
  const mutationStore = createStore(snapshot);
  return {
    mutationGraph: createTypeClient(mutationStore, productGraph),
    mutationStore,
  };
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

  it("omits protected predicates from snapshot reads and rejects explicit direct reads", async () => {
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
    expect(
      humanSnapshot.edges.some(
        (edge) => edge.s === principalId && edge.p === principalHomeGraphIdPredicateId,
      ),
    ).toBe(false);
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
