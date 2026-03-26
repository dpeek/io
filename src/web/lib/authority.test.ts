import { describe, expect, it, setDefaultTimeout } from "bun:test";

import {
  createIdMap,
  createStore,
  createTypeClient,
  applyIdMap,
  defineSecretField,
  defineType,
  edgeId,
  type AnyTypeOutput,
  type AuthSubjectRef,
  type AuthorizationContext,
  type InvalidationEvent,
  type SerializedQueryRequest,
  type GraphStoreSnapshot,
} from "@io/core/graph";
import { core } from "@io/core/graph/modules";
import { ops } from "@io/core/graph/modules/ops";
import {
  type RetainedWorkflowProjectionState,
  workflowBuiltInQuerySurfaceIds,
  workflowProjectionMetadata,
  workflowReviewDependencyKeys,
  workflowReviewModuleReadScope,
  workflowReviewSyncScopeRequest,
} from "@io/core/graph/modules/ops/workflow";
import { pkm } from "@io/core/graph/modules/pkm";
import { createSyncedTypeClient } from "@io/core/graph/runtime";
import { type GraphWriteTransaction } from "@io/graph-kernel";

import {
  createBearerShareAuthorizationContext,
  createAnonymousAuthorizationContext,
  issueBearerShareToken,
  type SessionPrincipalLookupInput,
} from "./auth-bridge.js";
import {
  createTestWebAppAuthority,
  createTestWorkflowFixture,
  createTestWebAppAuthorityWithWorkflowFixture,
  executeTestWorkflowMutation as executeWorkflowMutation,
  type WorkflowFixture,
} from "./authority-test-helpers.js";
import { createInMemoryTestWebAppAuthorityStorage } from "./authority-test-storage.js";
import {
  applyStagedWebAuthorityMutation,
  type WebAppAuthority,
  type WebAuthorityCommand,
  WebAppAuthorityWorkflowReadError,
  WebAppAuthorityWorkflowLiveScopeError,
  type WebAppAuthorityStorage,
  type WebAppAuthoritySyncOptions,
  type WebAppAuthorityTransactionOptions,
} from "./authority.js";
import { webAppPolicyVersion } from "./policy-version.js";
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
const secretNoteNamespace = applyIdMap(createIdMap({ secretNote }).map, {
  secretNote,
});
const secretNoteGraph = { ...productGraph, ...secretNoteNamespace } as const;
const secretNoteSecretPredicateId = edgeId(secretNote.fields.secret);
const capabilityNote = defineType({
  values: { key: "test:capabilityNote", name: "Capability Note" },
  fields: {
    readNote: {
      ...core.node.fields.description,
      key: "test:capabilityNote:readNote",
      authority: {
        visibility: "replicated",
        write: "authority-only",
        policy: {
          readAudience: "capability",
          writeAudience: "authority",
          shareable: false,
          requiredCapabilities: ["test.capability.note.read"],
        },
      },
      meta: {
        ...core.node.fields.description.meta,
        label: "Read-gated note",
      },
    },
    writeNote: {
      ...core.node.fields.description,
      key: "test:capabilityNote:writeNote",
      authority: {
        visibility: "replicated",
        write: "client-tx",
        policy: {
          readAudience: "public",
          writeAudience: "capability",
          shareable: false,
          requiredCapabilities: ["test.capability.note.write"],
        },
      },
      meta: {
        ...core.node.fields.description.meta,
        label: "Write-gated note",
      },
    },
  },
});
const capabilityNoteNamespace = applyIdMap(createIdMap({ capabilityNote }).map, {
  capabilityNote,
});
const capabilityGraph = { ...productGraph, ...capabilityNoteNamespace } as const;
const capabilityReadNotePredicateId = edgeId(capabilityNote.fields.readNote);
const capabilityWriteNotePredicateId = edgeId(capabilityNote.fields.writeNote);
const shareProbe = defineType({
  values: { key: "test:shareProbe", name: "Share Probe" },
  fields: {
    ...core.node.fields,
    sharedNote: {
      ...core.node.fields.description,
      key: "test:shareProbe:sharedNote",
      authority: {
        visibility: "replicated",
        write: "authority-only",
        policy: {
          readAudience: "graph-member",
          writeAudience: "authority",
          shareable: true,
        },
      },
      meta: {
        ...core.node.fields.description.meta,
        label: "Shared note",
      },
    },
    privateNote: {
      ...core.node.fields.description,
      key: "test:shareProbe:privateNote",
      authority: {
        visibility: "replicated",
        write: "authority-only",
        policy: {
          readAudience: "graph-member",
          writeAudience: "authority",
          shareable: false,
        },
      },
      meta: {
        ...core.node.fields.description.meta,
        label: "Private note",
      },
    },
  },
});
const shareProbeNamespace = applyIdMap(createIdMap({ shareProbe }).map, {
  shareProbe,
});
const shareProofGraph = { ...productGraph, ...shareProbeNamespace } as const;
const shareProbeSharedNotePredicateId = edgeId(shareProbe.fields.sharedNote);
const shareProbePrivateNotePredicateId = edgeId(shareProbe.fields.privateNote);
const editableNote = defineType({
  values: { key: "test:editableNote", name: "Editable Note" },
  fields: {
    ...core.node.fields,
  },
});
const editableNoteNamespace = applyIdMap(createIdMap({ editableNote }).map, {
  editableNote,
});
const editableNoteGraph = { ...productGraph, ...editableNoteNamespace } as const;

setDefaultTimeout(20_000);

function date(value: string): Date {
  return new Date(value);
}

function expectIsoTimestamp(value: string) {
  expect(new Date(value).toISOString()).toBe(value);
}

function createTestAuthorizationContext(
  overrides: Partial<AuthorizationContext> = {},
): AuthorizationContext {
  return {
    ...createAnonymousAuthorizationContext({
      graphId: "graph:test",
      policyVersion: webAppPolicyVersion,
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

function createProjectedAuthorizationContext(
  lookupInput: SessionPrincipalLookupInput,
  projection: {
    readonly summary?: {
      readonly principalId: string;
      readonly principalKind: AuthorizationContext["principalKind"];
      readonly roleKeys: readonly string[];
      readonly capabilityGrantIds: readonly string[];
      readonly capabilityVersion: number;
    };
    readonly principalId: string;
    readonly principalKind: AuthorizationContext["principalKind"];
    readonly roleKeys?: readonly string[];
    readonly capabilityGrantIds?: readonly string[];
    readonly capabilityVersion?: number;
  },
  overrides: Partial<AuthorizationContext> = {},
): AuthorizationContext {
  const summary = projection.summary;
  return createTestAuthorizationContext({
    graphId: lookupInput.graphId,
    principalId: summary?.principalId ?? projection.principalId,
    principalKind: summary?.principalKind ?? projection.principalKind,
    sessionId: "session:browser",
    roleKeys: [...(summary?.roleKeys ?? projection.roleKeys ?? [])],
    capabilityGrantIds: [...(summary?.capabilityGrantIds ?? projection.capabilityGrantIds ?? [])],
    capabilityVersion: summary?.capabilityVersion ?? projection.capabilityVersion ?? 0,
    ...overrides,
  });
}

function createBearerAuthorizationContext(
  capabilityGrantIds: readonly string[],
  overrides: Partial<AuthorizationContext> = {},
): AuthorizationContext {
  return {
    ...createBearerShareAuthorizationContext({
      graphId: "graph:test",
      policyVersion: 0,
      capabilityGrantIds,
    }),
    ...overrides,
  };
}

const workflowModuleScope = workflowReviewSyncScopeRequest;

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
  before: GraphStoreSnapshot,
  after: GraphStoreSnapshot,
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
  snapshot: GraphStoreSnapshot,
  graph: TGraph,
) {
  const mutationStore = createStore(snapshot);
  return {
    mutationGraph: createTypeClient(mutationStore, graph),
    mutationStore,
  };
}

function createProductMutationStore(snapshot: GraphStoreSnapshot) {
  return createMutationStoreForGraph(snapshot, productGraph);
}

function expectWorkflowReadError(
  callback: () => unknown,
  code: WebAppAuthorityWorkflowReadError["code"],
) {
  try {
    callback();
    throw new Error(`Expected a workflow read error with code "${code}".`);
  } catch (error) {
    expect(error).toBeInstanceOf(WebAppAuthorityWorkflowReadError);
    expect(error).toMatchObject({ code });
  }
}

function expectRecoveredWorkflowProjection(
  actual: RetainedWorkflowProjectionState | undefined,
  expected: RetainedWorkflowProjectionState,
) {
  expect(actual?.rows).toEqual(expected.rows);
  expect(actual?.checkpoints).toHaveLength(expected.checkpoints.length);
  expect(actual?.checkpoints.map((checkpoint) => checkpoint.projectionId)).toEqual(
    expected.checkpoints.map((checkpoint) => checkpoint.projectionId),
  );
  expect(actual?.checkpoints.map((checkpoint) => checkpoint.definitionHash)).toEqual(
    expected.checkpoints.map((checkpoint) => checkpoint.definitionHash),
  );
  expect(actual?.checkpoints.map((checkpoint) => checkpoint.sourceCursor)).toEqual(
    expected.checkpoints.map((checkpoint) => checkpoint.sourceCursor),
  );
  expect(actual?.checkpoints.map((checkpoint) => checkpoint.projectionCursor)).toEqual(
    expected.checkpoints.map((checkpoint) => checkpoint.projectionCursor),
  );
}

async function seedWorkflowProjectionReadFixture(
  authority: WebAppAuthority,
  authorization: AuthorizationContext,
  fixture: WorkflowFixture,
) {
  await executeWorkflowMutation(authority, authorization, {
    action: "updateBranch",
    branchId: fixture.branchId,
    queueRank: 1,
  });
  const backlogBranch = await executeWorkflowMutation(authority, authorization, {
    action: "createBranch",
    projectId: fixture.projectId,
    title: "Backlog docs",
    branchKey: "branch:backlog-docs",
    queueRank: 3,
    state: "backlog",
  });
  const noRankBranch = await executeWorkflowMutation(authority, authorization, {
    action: "createBranch",
    projectId: fixture.projectId,
    title: "Unranked polish",
    branchKey: "branch:unranked-polish",
    state: "ready",
  });
  const commit1 = await executeWorkflowMutation(authority, authorization, {
    action: "createCommit",
    branchId: fixture.branchId,
    title: "Define branch board scope",
    commitKey: "commit:define-branch-board-scope",
    order: 1,
    state: "ready",
  });
  const commit2 = await executeWorkflowMutation(authority, authorization, {
    action: "createCommit",
    branchId: fixture.branchId,
    title: "Document commit queue scope",
    commitKey: "commit:document-commit-queue-scope",
    order: 2,
    state: "ready",
  });
  const commit3 = await executeWorkflowMutation(authority, authorization, {
    action: "createCommit",
    branchId: fixture.branchId,
    title: "Surface session summaries",
    commitKey: "commit:surface-session-summaries",
    order: 3,
    state: "ready",
  });

  await executeWorkflowMutation(authority, authorization, {
    action: "setCommitState",
    commitId: commit1.summary.id,
    state: "active",
  });

  const repositoryCommit1 = await executeWorkflowMutation(authority, authorization, {
    action: "createRepositoryCommit",
    repositoryId: fixture.repositoryId,
    repositoryBranchId: fixture.repositoryBranchId,
    workflowCommitId: commit1.summary.id,
    title: "Define branch board scope",
    state: "attached",
    worktree: {
      branchName: "workflow-authority",
      leaseState: "attached",
      path: "/tmp/io-worktree",
    },
  });

  await executeWorkflowMutation(authority, authorization, {
    action: "attachCommitResult",
    repositoryCommitId: repositoryCommit1.summary.id,
    repositoryBranchId: fixture.repositoryBranchId,
    workflowCommitId: commit1.summary.id,
    sha: "abcdef1234567",
    committedAt: "2026-01-02T12:00:00.000Z",
  });

  await executeWorkflowMutation(authority, authorization, {
    action: "setCommitState",
    commitId: commit2.summary.id,
    state: "active",
  });

  const repositoryCommit2 = await executeWorkflowMutation(authority, authorization, {
    action: "createRepositoryCommit",
    repositoryId: fixture.repositoryId,
    repositoryBranchId: fixture.repositoryBranchId,
    workflowCommitId: commit2.summary.id,
    title: "Document commit queue scope",
    state: "attached",
    worktree: {
      branchName: "workflow-authority",
      leaseState: "attached",
      path: "/tmp/io-worktree",
    },
  });

  const { mutationGraph, mutationStore } = createProductMutationStore(
    authority.readSnapshot({ authorization }),
  );
  const before = mutationStore.snapshot();
  mutationGraph.repositoryBranch.update(fixture.repositoryBranchId, {
    latestReconciledAt: date("2026-01-05T12:00:00.000Z"),
    updatedAt: date("2026-01-05T12:00:00.000Z"),
  });
  const unmanagedRepositoryBranchId = mutationGraph.repositoryBranch.create({
    name: "observed/fixup",
    project: fixture.projectId,
    repository: fixture.repositoryId,
    managed: false,
    branchName: "observed/fixup",
    baseBranchName: "main",
    latestReconciledAt: date("2026-01-06T00:00:00.000Z"),
    createdAt: date("2026-01-04T00:00:00.000Z"),
    updatedAt: date("2026-01-06T00:00:00.000Z"),
  });
  const sessionId = mutationGraph.agentSession.create({
    name: "Execute workflow authority read",
    project: fixture.projectId,
    repository: fixture.repositoryId,
    subjectKind: ops.agentSessionSubjectKind.values.commit.id,
    branch: fixture.branchId,
    commit: commit2.summary.id,
    sessionKey: "session:workflow-authority-execution-01",
    kind: ops.agentSessionKind.values.execution.id,
    workerId: "worker-1",
    runtimeState: ops.agentSessionRuntimeState.values.running.id,
    startedAt: date("2026-01-05T12:30:00.000Z"),
    createdAt: date("2026-01-05T12:30:00.000Z"),
    updatedAt: date("2026-01-05T12:30:00.000Z"),
  });

  await authority.applyTransaction(
    buildGraphWriteTransaction(
      before,
      mutationStore.snapshot(),
      "tx:seed-workflow-projection-read",
    ),
    { authorization },
  );

  return {
    backlogBranchId: backlogBranch.summary.id,
    commit1Id: commit1.summary.id,
    commit2Id: commit2.summary.id,
    commit3Id: commit3.summary.id,
    noRankBranchId: noRankBranch.summary.id,
    repositoryCommit1Id: repositoryCommit1.summary.id,
    repositoryCommit2Id: repositoryCommit2.summary.id,
    sessionId,
    unmanagedRepositoryBranchId,
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
  snapshot: GraphStoreSnapshot,
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
    readonly email?: string;
    readonly subject?: Partial<AuthSubjectRef>;
  } = {},
): SessionPrincipalLookupInput {
  return {
    graphId: overrides.graphId ?? "graph:test",
    email: overrides.email,
    subject: {
      issuer: "better-auth",
      provider: "user",
      providerAccountId: "user-1",
      authUserId: "auth-user-1",
      ...overrides.subject,
    },
  };
}

async function writeAdmissionPolicy(
  authority: WebAppAuthority,
  authorization: AuthorizationContext,
  input: {
    readonly graphId?: string;
    readonly bootstrapMode?: string;
    readonly signupPolicy?: string;
    readonly allowedEmailDomain?: readonly string[];
    readonly firstUserRoleKey?: readonly string[];
    readonly signupRoleKey?: readonly string[];
  } = {},
): Promise<void> {
  const { mutationGraph, mutationStore } = createProductMutationStore(
    authority.readSnapshot({ authorization }),
  );
  const before = mutationStore.snapshot();
  const graphId = input.graphId ?? "graph:test";
  const existing = mutationGraph.admissionPolicy
    .list()
    .find((policy) => policy.graphId === graphId);
  const nextValues = {
    allowedEmailDomain: [...(input.allowedEmailDomain ?? [])],
    bootstrapMode: input.bootstrapMode ?? core.admissionBootstrapMode.values.manual.id,
    firstUserRoleKey: [...(input.firstUserRoleKey ?? ["graph:owner"])],
    graphId,
    name: "Admission policy",
    signupPolicy: input.signupPolicy ?? core.admissionSignupPolicy.values.closed.id,
    signupRoleKey: [...(input.signupRoleKey ?? ["graph:member"])],
  };

  if (existing) {
    mutationGraph.admissionPolicy.update(existing.id, nextValues);
  } else {
    mutationGraph.admissionPolicy.create(nextValues);
  }

  await authority.applyTransaction(
    buildGraphWriteTransaction(
      before,
      mutationStore.snapshot(),
      `tx:write-admission-policy:${Date.now()}`,
    ),
    {
      authorization,
      writeScope: "authority-only",
    },
  );
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

  it("prunes plaintext side rows when a secret-backed reference is retracted", async () => {
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
    expect(storage.read()?.secrets?.[created.secretId]).toBeUndefined();
    expect(JSON.stringify(authority.createSyncPayload({ authorization }))).not.toContain(
      "sk-live-first",
    );

    const restarted = await createTestWebAppAuthority(storage.storage);

    expect(
      readStringPredicateValue(restarted, authorization, envVarId, envVarSecretPredicateId),
    ).toBeUndefined();
    expect(storage.read()?.secrets?.[created.secretId]).toBeUndefined();
    expect(JSON.stringify(restarted.createSyncPayload({ authorization }))).not.toContain(
      "sk-live-first",
    );
  });

  it("prunes plaintext side rows when retracting an entity that owns a secret-backed reference", async () => {
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
    expect(storage.read()?.secrets?.[created.secretId]).toBeUndefined();
    expect(JSON.stringify(authority.createSyncPayload({ authorization }))).not.toContain(
      "sk-live-first",
    );

    const restarted = await createTestWebAppAuthority(storage.storage);

    expect(createStore(restarted.readSnapshot({ authorization })).facts(envVarId)).toHaveLength(0);
    expect(storage.read()?.secrets?.[created.secretId]).toBeUndefined();
    expect(JSON.stringify(restarted.createSyncPayload({ authorization }))).not.toContain(
      "sk-live-first",
    );
  });

  it("prunes orphaned plaintext side rows during restart bootstrap", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const backingStorage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(backingStorage.storage);
    const liveEnvVarId = await createEnvVar(
      authority,
      authorization,
      {
        description: "Primary model credential",
        name: "OPENAI_API_KEY",
      },
      "tx:create-env-var:live-secret-bootstrap",
    );
    const orphanedEnvVarId = await createEnvVar(
      authority,
      authorization,
      {
        description: "Secondary model credential",
        name: "ANTHROPIC_API_KEY",
      },
      "tx:create-env-var:orphan-secret-bootstrap",
    );
    const liveSecret = await authority.writeSecretField(
      {
        entityId: liveEnvVarId,
        predicateId: envVarSecretPredicateId,
        plaintext: "sk-live-first",
      },
      { authorization },
    );
    await authority.writeSecretField(
      {
        entityId: orphanedEnvVarId,
        predicateId: envVarSecretPredicateId,
        plaintext: "sk-orphaned-first",
      },
      { authorization },
    );
    const retractTransaction = buildRetractSecretReferenceTransaction(
      authority.readSnapshot({ authorization }),
      orphanedEnvVarId,
      "tx:retract-env-var-secret:orphan-bootstrap",
    );

    await applyServerCommandTransaction(authority, authorization, retractTransaction);

    const requestedSecretIds: Array<readonly string[] | undefined> = [];
    const restarted = await createTestWebAppAuthority({
      load() {
        return backingStorage.storage.load();
      },
      loadWorkflowProjection() {
        return backingStorage.storage.loadWorkflowProjection();
      },
      replaceWorkflowProjection(workflowProjection) {
        return backingStorage.storage.replaceWorkflowProjection(workflowProjection);
      },
      inspectSecrets() {
        return backingStorage.storage.inspectSecrets();
      },
      loadSecrets(options) {
        requestedSecretIds.push(options?.secretIds);
        return backingStorage.storage.loadSecrets(options);
      },
      repairSecrets(input) {
        return backingStorage.storage.repairSecrets(input);
      },
      commit(input, options) {
        return backingStorage.storage.commit(input, options);
      },
      persist(input, options) {
        return backingStorage.storage.persist(input, options);
      },
    });
    const confirmedLive = await restarted.writeSecretField(
      {
        entityId: liveEnvVarId,
        predicateId: envVarSecretPredicateId,
        plaintext: "sk-live-first",
      },
      { authorization },
    );

    expect(requestedSecretIds).toEqual([[liveSecret.secretId]]);
    expect(backingStorage.read()?.secrets).toEqual({
      [liveSecret.secretId]: expect.objectContaining({
        value: "sk-live-first",
      }),
    });
    expect(confirmedLive).toMatchObject({
      created: false,
      rotated: false,
      secretId: liveSecret.secretId,
      secretVersion: liveSecret.secretVersion,
    });
    expect(
      readStringPredicateValue(restarted, authorization, orphanedEnvVarId, envVarSecretPredicateId),
    ).toBeUndefined();
  });

  it("fails closed when a live secret handle loses its plaintext row across restart", async () => {
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
      "tx:create-env-var:missing-secret-row",
    );
    const created = await authority.writeSecretField(
      {
        entityId: envVarId,
        predicateId: envVarSecretPredicateId,
        plaintext: "sk-live-first",
      },
      { authorization },
    );
    const persisted = storage.read();
    if (!persisted) {
      throw new Error("Expected persisted authority state for restart drift test.");
    }

    const driftedSecrets = { ...persisted.secrets };
    delete driftedSecrets[created.secretId];
    const driftedStorage = createInMemoryTestWebAppAuthorityStorage({
      ...persisted,
      secrets: driftedSecrets,
    });

    await expect(createTestWebAppAuthority(driftedStorage.storage)).rejects.toThrow(
      `Cannot start web authority because secret storage drift was detected: missing plaintext rows for ${created.secretId}.`,
    );
  });

  it("fails closed when a live secret handle version drifts from side storage across restart", async () => {
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
      "tx:create-env-var:secret-version-drift",
    );
    const created = await authority.writeSecretField(
      {
        entityId: envVarId,
        predicateId: envVarSecretPredicateId,
        plaintext: "sk-live-first",
      },
      { authorization },
    );
    const persisted = storage.read();
    if (!persisted) {
      throw new Error("Expected persisted authority state for restart drift test.");
    }

    const driftedStorage = createInMemoryTestWebAppAuthorityStorage({
      ...persisted,
      secrets: {
        ...persisted.secrets,
        [created.secretId]: {
          ...(persisted.secrets?.[created.secretId] ?? {
            value: "sk-live-first",
            version: created.secretVersion,
          }),
          version: created.secretVersion + 1,
        },
      },
    });

    await expect(createTestWebAppAuthority(driftedStorage.storage)).rejects.toThrow(
      `Cannot start web authority because secret storage drift was detected: version mismatch for ${created.secretId} (graph ${created.secretVersion}, stored ${created.secretVersion + 1}).`,
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
      loadWorkflowProjection() {
        return backingStorage.storage.loadWorkflowProjection();
      },
      replaceWorkflowProjection(workflowProjection) {
        return backingStorage.storage.replaceWorkflowProjection(workflowProjection);
      },
      inspectSecrets() {
        return backingStorage.storage.inspectSecrets();
      },
      loadSecrets() {
        return backingStorage.storage.loadSecrets();
      },
      repairSecrets(input) {
        return backingStorage.storage.repairSecrets(input);
      },
      async commit(input, options) {
        if (failServerCommandCommit) {
          throw new Error("forced server-command commit failure");
        }
        await backingStorage.storage.commit(input, options);
      },
      persist(input, options) {
        return backingStorage.storage.persist(input, options);
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

  it("allows graph members to apply direct client transactions for ordinary fields", async () => {
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
      "tx:create-env-var",
    );

    await expect(authority.applyTransaction(transaction, { authorization })).resolves.toMatchObject(
      {
        replayed: false,
        txId: "tx:create-env-var",
        writeScope: "client-tx",
      },
    );
    expect(storage.read()?.writeHistory.results.length ?? 0).toBe(1);
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

    await expect(
      authority.executeCommand(
        {
          kind: "set-admission-approval",
          input: {
            email: "operator@example.com",
            graphId: authorization.graphId,
            roleKeys: ["graph:authority", "graph:owner"],
          },
        },
        { authorization },
      ),
    ).rejects.toMatchObject({
      code: "policy.command.forbidden",
      message: expect.stringContaining("policy.command.forbidden"),
      status: 403,
    });
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

  it("rejects stale read contexts and invalidates scoped cursors after authority policy-version changes", async () => {
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const initialPolicyVersion = 7;
    const nextPolicyVersion = 8;
    const initialAuthorization = createAuthorityAuthorizationContext({
      policyVersion: initialPolicyVersion,
    });
    const initialAuthority = await createTestWebAppAuthority(storage.storage, {
      policyVersion: initialPolicyVersion,
    });
    const scopedTotal = initialAuthority.createSyncPayload({
      authorization: initialAuthorization,
      scope: workflowModuleScope,
    });

    expect(initialAuthority.getPolicyVersion()).toBe(initialPolicyVersion);
    expect(scopedTotal).toMatchObject({
      scope: expect.objectContaining({
        policyFilterVersion: `policy:${initialPolicyVersion}`,
      }),
    });

    const updatedAuthority = await createTestWebAppAuthority(storage.storage, {
      policyVersion: nextPolicyVersion,
    });

    expect(() =>
      updatedAuthority.createSyncPayload({
        authorization: initialAuthorization,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "policy.stale_context",
        message: expect.stringContaining(`"${nextPolicyVersion}"`),
        status: 409,
      }),
    );

    const refreshedAuthorization = createAuthorityAuthorizationContext({
      policyVersion: nextPolicyVersion,
    });
    const invalidated = updatedAuthority.getIncrementalSyncResult(scopedTotal.cursor, {
      authorization: refreshedAuthorization,
      scope: workflowModuleScope,
    });

    expect(updatedAuthority.getPolicyVersion()).toBe(nextPolicyVersion);
    expect(invalidated).toMatchObject({
      mode: "incremental",
      fallback: "policy-changed",
      after: scopedTotal.cursor,
      scope: expect.objectContaining({
        policyFilterVersion: `policy:${nextPolicyVersion}`,
      }),
    });
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

  it("reads workflow branch board and commit queue scopes from authoritative graph state", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const { authority, fixture } =
      await createTestWebAppAuthorityWithWorkflowFixture(authorization);
    const seeded = await seedWorkflowProjectionReadFixture(authority, authorization, fixture);

    const branchBoard = authority.readProjectBranchScope(
      {
        projectId: fixture.projectId,
        filter: {
          showUnmanagedRepositoryBranches: true,
        },
        limit: 2,
      },
      { authorization },
    );
    const branchProjectionCursor = branchBoard.freshness.projectionCursor;

    expectIsoTimestamp(branchBoard.freshness.projectedAt);
    expect(branchProjectionCursor).toEqual(expect.any(String));
    if (!branchProjectionCursor) {
      throw new Error("Expected the branch board read to include a projection cursor.");
    }

    expect(branchBoard.project.projectKey).toBe("project:io");
    expect(branchBoard.repository?.repositoryKey).toBe("repo:io");
    expect(branchBoard.rows.map((row) => row.workflowBranch.id)).toEqual([
      fixture.branchId,
      seeded.backlogBranchId,
    ]);
    expect(branchBoard.rows[0]?.repositoryBranch).toMatchObject({
      freshness: "fresh",
      repositoryBranch: {
        id: fixture.repositoryBranchId,
        branchName: "workflow-authority",
      },
    });
    expect(branchBoard.unmanagedRepositoryBranches).toMatchObject([
      {
        freshness: "fresh",
        repositoryBranch: {
          id: seeded.unmanagedRepositoryBranchId,
          branchName: "observed/fixup",
        },
      },
    ]);
    expect(branchBoard.freshness).toMatchObject({
      repositoryFreshness: "fresh",
      repositoryReconciledAt: "2026-01-06T00:00:00.000Z",
    });
    expect(branchBoard.nextCursor).toEqual(expect.any(String));

    const secondBranchPage = authority.readProjectBranchScope(
      {
        projectId: fixture.projectId,
        cursor: branchBoard.nextCursor,
        limit: 2,
      },
      { authorization },
    );

    expect(secondBranchPage.rows.map((row) => row.workflowBranch.id)).toEqual([
      seeded.noRankBranchId,
    ]);
    expectIsoTimestamp(secondBranchPage.freshness.projectedAt);
    expect(secondBranchPage.freshness.projectionCursor).toBe(branchProjectionCursor);
    expect(secondBranchPage.nextCursor).toBeUndefined();

    const commitQueue = authority.readCommitQueueScope(
      {
        branchId: fixture.branchId,
        limit: 2,
      },
      { authorization },
    );

    expectIsoTimestamp(commitQueue.freshness.projectedAt);
    expect(commitQueue.freshness.projectionCursor).toBe(branchProjectionCursor);
    expect(commitQueue.freshness).toMatchObject({
      repositoryFreshness: "fresh",
      repositoryReconciledAt: "2026-01-06T00:00:00.000Z",
    });
    expect(commitQueue.branch.workflowBranch.activeCommitId).toBe(seeded.commit2Id);
    expect(commitQueue.branch.activeCommit).toMatchObject({
      workflowCommit: {
        id: seeded.commit2Id,
        commitKey: "commit:document-commit-queue-scope",
      },
      repositoryCommit: {
        id: seeded.repositoryCommit2Id,
        state: "attached",
        worktree: {
          branchName: "workflow-authority",
          leaseState: "attached",
          path: "/tmp/io-worktree",
        },
      },
    });
    expect(commitQueue.branch.latestSession).toMatchObject({
      id: seeded.sessionId,
      sessionKey: "session:workflow-authority-execution-01",
      kind: "execution",
      runtimeState: "running",
      subject: {
        kind: "commit",
        commitId: seeded.commit2Id,
      },
    });
    expect(commitQueue.rows.map((row) => row.workflowCommit.id)).toEqual([
      seeded.commit1Id,
      seeded.commit2Id,
    ]);
    expect(commitQueue.rows[0]?.repositoryCommit).toMatchObject({
      id: seeded.repositoryCommit1Id,
      state: "committed",
      sha: "abcdef1234567",
    });
    expect(commitQueue.rows[1]?.repositoryCommit).toMatchObject({
      id: seeded.repositoryCommit2Id,
      state: "attached",
    });
    expect(commitQueue.nextCursor).toEqual(expect.any(String));

    const secondCommitPage = authority.readCommitQueueScope(
      {
        branchId: fixture.branchId,
        cursor: commitQueue.nextCursor,
        limit: 2,
      },
      { authorization },
    );

    expect(secondCommitPage.rows.map((row) => row.workflowCommit.id)).toEqual([seeded.commit3Id]);
    expectIsoTimestamp(secondCommitPage.freshness.projectedAt);
    expect(secondCommitPage.freshness.projectionCursor).toBe(branchProjectionCursor);
    expect(secondCommitPage.rows[0]?.repositoryCommit).toBeUndefined();
    expect(secondCommitPage.nextCursor).toBeUndefined();
  });

  it("executes serialized entity, neighborhood, and scope reads through the reusable authority seam", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const { authority, fixture } =
      await createTestWebAppAuthorityWithWorkflowFixture(authorization);

    await seedWorkflowProjectionReadFixture(authority, authorization, fixture);

    const entity = await authority.executeSerializedQuery(
      {
        version: 1,
        query: {
          kind: "entity",
          entityId: fixture.projectId,
        },
      } satisfies SerializedQueryRequest,
      { authorization },
    );
    expect(entity.ok).toBe(true);
    if (!entity.ok) {
      throw new Error("Expected entity serialized query execution to succeed.");
    }
    expect(entity.result.kind).toBe("entity");
    expect(entity.result.items[0]?.entityId).toBe(fixture.projectId);
    expect(Object.keys(entity.result.items[0]?.payload ?? {})).not.toHaveLength(0);

    const neighborhood = await authority.executeSerializedQuery(
      {
        version: 1,
        query: {
          kind: "neighborhood",
          rootId: fixture.projectId,
          depth: 1,
        },
      } satisfies SerializedQueryRequest,
      { authorization },
    );
    expect(neighborhood.ok).toBe(true);
    if (!neighborhood.ok) {
      throw new Error("Expected neighborhood serialized query execution to succeed.");
    }
    expect(neighborhood.result.kind).toBe("neighborhood");
    expect(neighborhood.result.items.map((item) => item.entityId)).toContain(fixture.projectId);

    const scoped = await authority.executeSerializedQuery(
      {
        version: 1,
        query: {
          kind: "scope",
          scopeId: workflowBuiltInQuerySurfaceIds.reviewScope,
        },
      } satisfies SerializedQueryRequest,
      { authorization },
    );
    expect(scoped.ok).toBe(true);
    if (!scoped.ok) {
      throw new Error("Expected scope serialized query execution to succeed.");
    }
    expect(scoped.result.kind).toBe("scope");
    expect(scoped.result.freshness.scopeCursor).toEqual(expect.any(String));
    expect(scoped.result.items.map((item) => item.entityId)).toContain(fixture.projectId);
  });

  it("dispatches serialized collection reads onto the registered workflow projection surfaces", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const { authority, fixture } =
      await createTestWebAppAuthorityWithWorkflowFixture(authorization);
    const seeded = await seedWorkflowProjectionReadFixture(authority, authorization, fixture);

    const branchBoard = await authority.executeSerializedQuery(
      {
        version: 1,
        query: {
          kind: "collection",
          indexId: workflowBuiltInQuerySurfaceIds.projectBranchBoard,
          filter: {
            op: "eq",
            fieldId: "projectId",
            value: {
              kind: "literal",
              value: fixture.projectId,
            },
          },
          order: [{ fieldId: "queue-rank", direction: "asc" }],
          window: {
            limit: 2,
          },
        },
      } satisfies SerializedQueryRequest,
      { authorization },
    );
    expect(branchBoard.ok).toBe(true);
    if (!branchBoard.ok) {
      throw new Error("Expected project-branch serialized collection query to succeed.");
    }
    expect(branchBoard.result.kind).toBe("collection");
    expect(branchBoard.result.items.map((item) => item.entityId)).toEqual([
      fixture.branchId,
      seeded.backlogBranchId,
    ]);
    expect(branchBoard.result.freshness.projectedAt).toEqual(expect.any(String));
    expect(branchBoard.result.nextCursor).toEqual(expect.any(String));

    const commitQueue = await authority.executeSerializedQuery(
      {
        version: 1,
        query: {
          kind: "collection",
          indexId: workflowBuiltInQuerySurfaceIds.branchCommitQueue,
          filter: {
            op: "eq",
            fieldId: "branchId",
            value: {
              kind: "literal",
              value: fixture.branchId,
            },
          },
          window: {
            limit: 2,
          },
        },
      } satisfies SerializedQueryRequest,
      { authorization },
    );
    expect(commitQueue.ok).toBe(true);
    if (!commitQueue.ok) {
      throw new Error("Expected commit-queue serialized collection query to succeed.");
    }
    expect(commitQueue.result.items.map((item) => item.entityId)).toEqual([
      seeded.commit1Id,
      seeded.commit2Id,
    ]);
    expect(commitQueue.result.freshness.projectionCursor).toBe(
      branchBoard.result.freshness.projectionCursor,
    );
  });

  it("fails closed for unsupported, invalid, stale, and mismatched serialized query pagination", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const otherAuthorization = createAuthorityAuthorizationContext({
      principalId: "principal:authority:other",
      sessionId: "session:authority:other",
    });
    const { authority, fixture } =
      await createTestWebAppAuthorityWithWorkflowFixture(authorization);

    await seedWorkflowProjectionReadFixture(authority, authorization, fixture);

    const unsupported = await authority.executeSerializedQuery(
      {
        version: 1,
        query: {
          kind: "collection",
          indexId: workflowBuiltInQuerySurfaceIds.projectBranchBoard,
          window: {
            limit: 2,
          },
        },
      } satisfies SerializedQueryRequest,
      { authorization },
    );
    expect(unsupported).toEqual({
      ok: false,
      code: "unsupported-query",
      error: `Collection query "${workflowBuiltInQuerySurfaceIds.projectBranchBoard}" requires an equality filter for "projectId".`,
    });

    const invalid = await authority.executeSerializedQuery(
      {
        version: 2,
        query: {
          kind: "entity",
          entityId: fixture.projectId,
        },
      } as unknown as SerializedQueryRequest,
      { authorization },
    );
    expect(invalid).toEqual({
      ok: false,
      code: "invalid-query",
      error: "Serialized query request.version must be 1.",
    });

    const firstPage = await authority.executeSerializedQuery(
      {
        version: 1,
        query: {
          kind: "collection",
          indexId: workflowBuiltInQuerySurfaceIds.projectBranchBoard,
          filter: {
            op: "eq",
            fieldId: "projectId",
            value: {
              kind: "literal",
              value: fixture.projectId,
            },
          },
          window: {
            limit: 1,
          },
        },
      } satisfies SerializedQueryRequest,
      { authorization },
    );
    expect(firstPage.ok).toBe(true);
    if (!firstPage.ok || !firstPage.result.nextCursor) {
      throw new Error("Expected a first serialized collection page with a follow-up cursor.");
    }

    const reusedAcrossQuery = await authority.executeSerializedQuery(
      {
        version: 1,
        query: {
          kind: "collection",
          indexId: workflowBuiltInQuerySurfaceIds.branchCommitQueue,
          filter: {
            op: "eq",
            fieldId: "branchId",
            value: {
              kind: "literal",
              value: fixture.branchId,
            },
          },
          window: {
            after: firstPage.result.nextCursor,
            limit: 1,
          },
        },
      } satisfies SerializedQueryRequest,
      { authorization },
    );
    expect(reusedAcrossQuery).toEqual({
      ok: false,
      code: "projection-stale",
      error: expect.stringContaining("stale for the current serialized query"),
    });

    const reusedAcrossPrincipal = await authority.executeSerializedQuery(
      {
        version: 1,
        query: {
          kind: "collection",
          indexId: workflowBuiltInQuerySurfaceIds.projectBranchBoard,
          filter: {
            op: "eq",
            fieldId: "projectId",
            value: {
              kind: "literal",
              value: fixture.projectId,
            },
          },
          window: {
            after: firstPage.result.nextCursor,
            limit: 1,
          },
        },
      } satisfies SerializedQueryRequest,
      { authorization: otherAuthorization },
    );
    expect(reusedAcrossPrincipal).toEqual({
      ok: false,
      code: "projection-stale",
      error: expect.stringContaining("stale for the current serialized query"),
    });

    const staleProjection = await authority.executeSerializedQuery(
      {
        version: 1,
        query: {
          kind: "collection",
          indexId: workflowBuiltInQuerySurfaceIds.projectBranchBoard,
          filter: {
            op: "eq",
            fieldId: "projectId",
            value: {
              kind: "literal",
              value: fixture.projectId,
            },
          },
          window: {
            after: firstPage.result.nextCursor,
            limit: 1,
          },
        },
      } satisfies SerializedQueryRequest,
      { authorization },
    );
    expect(staleProjection.ok).toBe(true);
    if (!staleProjection.ok || !staleProjection.result.nextCursor) {
      throw new Error("Expected serialized pagination continuation to succeed before rebuild.");
    }

    await executeWorkflowMutation(authority, authorization, {
      action: "createBranch",
      projectId: fixture.projectId,
      title: "Projection stale branch",
      branchKey: "branch:projection-stale-serialized-query",
      state: "ready",
    });

    const staleAfterRebuild = await authority.executeSerializedQuery(
      {
        version: 1,
        query: {
          kind: "collection",
          indexId: workflowBuiltInQuerySurfaceIds.projectBranchBoard,
          filter: {
            op: "eq",
            fieldId: "projectId",
            value: {
              kind: "literal",
              value: fixture.projectId,
            },
          },
          window: {
            after: staleProjection.result.nextCursor,
            limit: 1,
          },
        },
      } satisfies SerializedQueryRequest,
      { authorization },
    );
    expect(staleAfterRebuild).toMatchObject({
      ok: false,
      code: "projection-stale",
    });
    if (staleAfterRebuild.ok) {
      throw new Error("Expected stale serialized collection execution to fail closed.");
    }
    expect(staleAfterRebuild.error).toContain("is stale for the current workflow projection");

    const restartedFromFirstPage = await authority.executeSerializedQuery(
      {
        version: 1,
        query: {
          kind: "collection",
          indexId: workflowBuiltInQuerySurfaceIds.projectBranchBoard,
          filter: {
            op: "eq",
            fieldId: "projectId",
            value: {
              kind: "literal",
              value: fixture.projectId,
            },
          },
          window: {
            limit: 4,
          },
        },
      } satisfies SerializedQueryRequest,
      { authorization },
    );
    expect(restartedFromFirstPage.ok).toBe(true);
  });

  it("fails closed when workflow pagination cursors are reused across different projections", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const { authority, fixture } =
      await createTestWebAppAuthorityWithWorkflowFixture(authorization);

    await seedWorkflowProjectionReadFixture(authority, authorization, fixture);

    const otherProject = await executeWorkflowMutation(authority, authorization, {
      action: "createProject",
      inferred: false,
      title: "Other project",
      projectKey: "project:other",
    });
    const otherBranch = await executeWorkflowMutation(authority, authorization, {
      action: "createBranch",
      projectId: fixture.projectId,
      title: "Other branch",
      branchKey: "branch:other-branch",
      state: "ready",
    });

    const branchPage = authority.readProjectBranchScope(
      {
        projectId: fixture.projectId,
        limit: 1,
      },
      { authorization },
    );
    const commitPage = authority.readCommitQueueScope(
      {
        branchId: fixture.branchId,
        limit: 1,
      },
      { authorization },
    );

    expect(branchPage.nextCursor).toEqual(expect.any(String));
    expect(commitPage.nextCursor).toEqual(expect.any(String));

    expectWorkflowReadError(
      () =>
        authority.readProjectBranchScope(
          {
            projectId: otherProject.summary.id,
            cursor: branchPage.nextCursor,
            limit: 1,
          },
          { authorization },
        ),
      "projection-stale",
    );
    expectWorkflowReadError(
      () =>
        authority.readCommitQueueScope(
          {
            branchId: otherBranch.summary.id,
            cursor: commitPage.nextCursor,
            limit: 1,
          },
          { authorization },
        ),
      "projection-stale",
    );
    expectWorkflowReadError(
      () =>
        authority.readCommitQueueScope(
          {
            branchId: fixture.branchId,
            cursor: branchPage.nextCursor,
            limit: 1,
          },
          { authorization },
        ),
      "projection-stale",
    );
  });

  it("rebuilds workflow projection reads and invalidates stale cursors after authoritative changes", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const { authority, fixture } =
      await createTestWebAppAuthorityWithWorkflowFixture(authorization);

    await seedWorkflowProjectionReadFixture(authority, authorization, fixture);

    const branchBoard = authority.readProjectBranchScope(
      {
        projectId: fixture.projectId,
        limit: 1,
      },
      { authorization },
    );
    const commitQueue = authority.readCommitQueueScope(
      {
        branchId: fixture.branchId,
        limit: 1,
      },
      { authorization },
    );

    expect(branchBoard.nextCursor).toEqual(expect.any(String));
    expect(commitQueue.nextCursor).toEqual(expect.any(String));

    await executeWorkflowMutation(authority, authorization, {
      action: "createBranch",
      projectId: fixture.projectId,
      title: "Fresh branch",
      branchKey: "branch:fresh-branch",
      queueRank: 2,
      state: "ready",
    });
    await executeWorkflowMutation(authority, authorization, {
      action: "createCommit",
      branchId: fixture.branchId,
      title: "Fresh commit",
      commitKey: "commit:fresh-commit",
      order: 4,
      state: "ready",
    });

    expectWorkflowReadError(
      () =>
        authority.readProjectBranchScope(
          {
            projectId: fixture.projectId,
            cursor: branchBoard.nextCursor,
            limit: 1,
          },
          { authorization },
        ),
      "projection-stale",
    );
    expectWorkflowReadError(
      () =>
        authority.readCommitQueueScope(
          {
            branchId: fixture.branchId,
            cursor: commitQueue.nextCursor,
            limit: 1,
          },
          { authorization },
        ),
      "projection-stale",
    );

    const refreshed = authority.readProjectBranchScope(
      {
        projectId: fixture.projectId,
        limit: 4,
      },
      { authorization },
    );

    expect(
      refreshed.rows.some((row) => row.workflowBranch.branchKey === "branch:fresh-branch"),
    ).toBe(true);
  });

  it("keeps retained workflow projection pagination stable across restart when retained state is present", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const { authority, fixture, storage } =
      await createTestWebAppAuthorityWithWorkflowFixture(authorization);

    await seedWorkflowProjectionReadFixture(authority, authorization, fixture);

    const firstPage = authority.readProjectBranchScope(
      {
        projectId: fixture.projectId,
        limit: 1,
      },
      { authorization },
    );

    expect(firstPage.nextCursor).toEqual(expect.any(String));

    const restarted = await createTestWebAppAuthority(storage.storage);
    const secondPage = restarted.readProjectBranchScope(
      {
        projectId: fixture.projectId,
        cursor: firstPage.nextCursor,
        limit: 1,
      },
      { authorization },
    );

    expect(secondPage.rows.map((row) => row.workflowBranch.branchKey)).toEqual([
      "branch:backlog-docs",
    ]);
  });

  it("rebuilds workflow projection reads from authoritative graph state when retained state is missing on restart", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const { authority, fixture, storage } =
      await createTestWebAppAuthorityWithWorkflowFixture(authorization);

    const seeded = await seedWorkflowProjectionReadFixture(authority, authorization, fixture);
    const persisted = storage.read();
    if (!persisted) {
      throw new Error("Expected persisted authority state for restart recovery test.");
    }
    const expectedWorkflowProjection = persisted.workflowProjection;
    if (!expectedWorkflowProjection) {
      throw new Error("Expected retained workflow projection state before restart recovery.");
    }

    const restarted = await createTestWebAppAuthority({
      ...storage.storage,
      async loadWorkflowProjection() {
        return null;
      },
    });

    const branchBoard = restarted.readProjectBranchScope(
      {
        projectId: fixture.projectId,
        filter: {
          showUnmanagedRepositoryBranches: true,
        },
        limit: 3,
      },
      { authorization },
    );
    const commitQueue = restarted.readCommitQueueScope(
      {
        branchId: fixture.branchId,
        limit: 3,
      },
      { authorization },
    );

    expect(branchBoard.rows.map((row) => row.workflowBranch.id)).toEqual([
      fixture.branchId,
      seeded.backlogBranchId,
      seeded.noRankBranchId,
    ]);
    expect(branchBoard.unmanagedRepositoryBranches.map((row) => row.repositoryBranch.id)).toEqual([
      seeded.unmanagedRepositoryBranchId,
    ]);
    expect(commitQueue.rows.map((row) => row.workflowCommit.id)).toEqual([
      seeded.commit1Id,
      seeded.commit2Id,
      seeded.commit3Id,
    ]);
    expect(commitQueue.branch.latestSession?.id).toBe(seeded.sessionId);
    expectRecoveredWorkflowProjection(
      storage.read()?.workflowProjection,
      expectedWorkflowProjection,
    );
  });

  it("rebuilds retained workflow projection rows after retained row loss on restart", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const { authority, fixture, storage } =
      await createTestWebAppAuthorityWithWorkflowFixture(authorization);

    const seeded = await seedWorkflowProjectionReadFixture(authority, authorization, fixture);
    const persisted = storage.read();
    const workflowProjection = persisted?.workflowProjection;
    if (!persisted || !workflowProjection) {
      throw new Error("Expected retained workflow projection state for row-loss recovery test.");
    }

    const droppedBranchId = seeded.noRankBranchId;
    const corruptedStorage = createInMemoryTestWebAppAuthorityStorage({
      ...persisted,
      workflowProjection: {
        ...workflowProjection,
        rows: workflowProjection.rows.filter(
          (row) => !(row.rowKind === "branch" && row.rowKey === droppedBranchId),
        ),
      },
    });

    const restarted = await createTestWebAppAuthority(corruptedStorage.storage);
    const branchBoard = restarted.readProjectBranchScope(
      {
        projectId: fixture.projectId,
        limit: 3,
      },
      { authorization },
    );

    expect(branchBoard.rows.map((row) => row.workflowBranch.id)).toEqual([
      fixture.branchId,
      seeded.backlogBranchId,
      seeded.noRankBranchId,
    ]);
    expectRecoveredWorkflowProjection(
      corruptedStorage.read()?.workflowProjection,
      workflowProjection,
    );
  });

  it("rebuilds workflow projection reads from authoritative graph state when retained state is incompatible on restart", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const { authority, fixture, storage } =
      await createTestWebAppAuthorityWithWorkflowFixture(authorization);

    const seeded = await seedWorkflowProjectionReadFixture(authority, authorization, fixture);
    const persisted = storage.read();
    const workflowProjection = persisted?.workflowProjection;
    if (!workflowProjection) {
      throw new Error("Expected retained workflow projection state for compatibility test.");
    }

    const restarted = await createTestWebAppAuthority({
      ...storage.storage,
      async loadWorkflowProjection() {
        return {
          ...workflowProjection,
          checkpoints: workflowProjection.checkpoints.map((checkpoint) =>
            checkpoint.projectionId === workflowProjectionMetadata.branchCommitQueue.projectionId
              ? {
                  ...checkpoint,
                  definitionHash: "projection-def:ops/workflow:branch-commit-queue:v999",
                }
              : checkpoint,
          ),
        };
      },
    });

    const commitQueue = restarted.readCommitQueueScope(
      {
        branchId: fixture.branchId,
        limit: 3,
      },
      { authorization },
    );

    expect(commitQueue.rows.map((row) => row.workflowCommit.id)).toEqual([
      seeded.commit1Id,
      seeded.commit2Id,
      seeded.commit3Id,
    ]);
    expect(commitQueue.branch.activeCommit?.workflowCommit.id).toBe(seeded.commit2Id);
    expect(commitQueue.branch.latestSession?.id).toBe(seeded.sessionId);
    expectRecoveredWorkflowProjection(storage.read()?.workflowProjection, workflowProjection);
  });

  it("surfaces stable workflow read failure codes", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const { authority, fixture } =
      await createTestWebAppAuthorityWithWorkflowFixture(authorization);

    expectWorkflowReadError(
      () =>
        authority.readProjectBranchScope(
          {
            projectId: "project:missing",
          },
          { authorization },
        ),
      "project-not-found",
    );
    expectWorkflowReadError(
      () =>
        authority.readCommitQueueScope(
          {
            branchId: "branch:missing",
          },
          { authorization },
        ),
      "branch-not-found",
    );
    expectWorkflowReadError(
      () =>
        authority.readProjectBranchScope(
          {
            projectId: fixture.projectId,
          },
          {
            authorization: createAuthorityAuthorizationContext({
              policyVersion: 1,
            }),
          },
        ),
      "policy-denied",
    );
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
        definitionHash: workflowReviewModuleReadScope.definitionHash,
        policyFilterVersion: `policy:${webAppPolicyVersion}`,
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
    expect(incremental.transactions[0]?.cursor).toContain("moduleId=ops%2Fworkflow");
    expect(incremental.transactions[0]?.cursor).toBe(incremental.cursor);
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

  it("plans workflow review live registrations from the current scoped cursor", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const { authority } = await createTestWebAppAuthorityWithWorkflowFixture(authorization);
    const total = authority.createSyncPayload({
      authorization,
      scope: workflowModuleScope,
    });

    expect(
      authority.planWorkflowReviewLiveRegistration(total.cursor, {
        authorization,
      }),
    ).toEqual({
      sessionId: authorization.sessionId!,
      principalId: authorization.principalId!,
      scopeId: workflowReviewModuleReadScope.scopeId,
      definitionHash: workflowReviewModuleReadScope.definitionHash,
      policyFilterVersion: `policy:${webAppPolicyVersion}`,
      dependencyKeys: workflowReviewDependencyKeys,
    });
  });

  it("publishes cursor-advanced invalidations for accepted workflow writes", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const invalidations: InvalidationEvent[] = [];
    const authority = await createTestWebAppAuthority(
      createInMemoryTestWebAppAuthorityStorage().storage,
      {
        onWorkflowReviewInvalidation(invalidation) {
          invalidations.push(invalidation);
        },
      },
    );
    const fixture = await createTestWorkflowFixture(authority, authorization);
    invalidations.length = 0;

    await executeWorkflowMutation(authority, authorization, {
      action: "createCommit",
      branchId: fixture.branchId,
      title: "Workflow live invalidation",
      commitKey: "commit:workflow-live-invalidation",
      order: 0,
      state: "ready",
    });

    expect(invalidations).toEqual([
      {
        eventId: expect.stringContaining("workflow-review:web-authority:"),
        graphId: "graph:global",
        sourceCursor: expect.stringContaining("web-authority:"),
        dependencyKeys: workflowReviewDependencyKeys,
        affectedProjectionIds: [
          "ops/workflow:project-branch-board",
          "ops/workflow:branch-commit-queue",
        ],
        affectedScopeIds: [workflowReviewModuleReadScope.scopeId],
        delivery: { kind: "cursor-advanced" },
      },
    ]);
  });

  it("publishes cursor-advanced invalidations for direct accepted workflow transactions", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const invalidations: InvalidationEvent[] = [];
    const authority = await createTestWebAppAuthority(
      createInMemoryTestWebAppAuthorityStorage().storage,
      {
        onWorkflowReviewInvalidation(invalidation) {
          invalidations.push(invalidation);
        },
      },
    );
    const fixture = await createTestWorkflowFixture(authority, authorization);
    invalidations.length = 0;
    const { mutationGraph, mutationStore } = createProductMutationStore(
      authority.readSnapshot({ authorization }),
    );
    const before = mutationStore.snapshot();

    mutationGraph.workflowBranch.update(fixture.branchId, {
      name: "Workflow live invalidation transaction",
    });

    const result = await authority.applyTransaction(
      buildGraphWriteTransaction(
        before,
        mutationStore.snapshot(),
        "tx:workflow-live-invalidation:direct",
      ),
      { authorization },
    );

    expect(invalidations).toEqual([
      {
        eventId: `workflow-review:${result.cursor}`,
        graphId: "graph:global",
        sourceCursor: result.cursor,
        dependencyKeys: workflowReviewDependencyKeys,
        affectedProjectionIds: [
          "ops/workflow:project-branch-board",
          "ops/workflow:branch-commit-queue",
        ],
        affectedScopeIds: [workflowReviewModuleReadScope.scopeId],
        delivery: { kind: "cursor-advanced" },
      },
    ]);
  });

  it("does not publish workflow review invalidations for unrelated accepted writes", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const invalidations: InvalidationEvent[] = [];
    const authority = await createTestWebAppAuthority(
      createInMemoryTestWebAppAuthorityStorage().storage,
      {
        onWorkflowReviewInvalidation(invalidation) {
          invalidations.push(invalidation);
        },
      },
    );

    await createEnvVar(
      authority,
      authorization,
      {
        description: "Unrelated to workflow review live scopes",
        name: "OPENAI_API_KEY",
      },
      "tx:workflow-live-invalidation:unrelated",
    );

    expect(invalidations).toEqual([]);
  });

  it("fails workflow review live registrations when scoped cursor assumptions drift", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const { authority } = await createTestWebAppAuthorityWithWorkflowFixture(authorization);
    const total = authority.createSyncPayload({
      authorization,
      scope: workflowModuleScope,
    });
    const policyChangedCursor = updateScopedCursor(total.cursor, {
      policyFilterVersion: "policy:999",
    });

    try {
      authority.planWorkflowReviewLiveRegistration(policyChangedCursor, {
        authorization,
      });
      throw new Error("Expected a workflow live registration failure.");
    } catch (error) {
      expect(error).toBeInstanceOf(WebAppAuthorityWorkflowLiveScopeError);
      expect(error).toMatchObject({
        status: 409,
        code: "policy-changed",
        message: `Workflow live registration cursor policy "policy:999" does not match the current workflow review policy filter "policy:${webAppPolicyVersion}". Re-sync and register again.`,
      });
    }
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

    expect(await authority.lookupSessionPrincipal(lookupInput)).toMatchObject({
      principalId,
      principalKind: "human",
      roleKeys: ["graph:member"],
      capabilityGrantIds: [],
      capabilityVersion: 1,
      summary: {
        graphId: lookupInput.graphId,
        principalId,
        principalKind: "human",
        roleKeys: ["graph:member"],
        capabilityGrantIds: [],
        access: {
          authority: false,
          graphMember: true,
          sharedRead: false,
        },
        capabilityVersion: 1,
        policyVersion: 0,
      },
    });
  });

  it("creates missing principals and subject projections idempotently on first authenticated use", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(storage.storage);
    const lookupInput = createSessionPrincipalLookupInput();

    await writeAdmissionPolicy(authority, authorization, {
      bootstrapMode: core.admissionBootstrapMode.values.firstUser.id,
      signupPolicy: core.admissionSignupPolicy.values.closed.id,
    });

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
    expect(productGraphClient.principalRoleBinding.list()).toHaveLength(0);
  });

  it("fails closed when admission policy denies first authenticated use", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(storage.storage);
    const lookupInput = createSessionPrincipalLookupInput({
      email: "operator@blocked.example",
    });

    await writeAdmissionPolicy(authority, authorization, {
      allowedEmailDomain: ["allowed.example"],
      bootstrapMode: core.admissionBootstrapMode.values.manual.id,
      signupPolicy: core.admissionSignupPolicy.values.closed.id,
    });

    await expect(authority.lookupSessionPrincipal(lookupInput)).rejects.toMatchObject({
      name: "WebAppAuthoritySessionPrincipalLookupError",
      code: "auth.principal_missing",
      reason: "denied",
      status: 403,
    });

    const productGraphClient = readProductGraph(authority, authorization);
    expect(productGraphClient.principal.list()).toHaveLength(0);
    expect(productGraphClient.authSubjectProjection.list()).toHaveLength(0);
    expect(productGraphClient.principalRoleBinding.list()).toHaveLength(0);
  });

  it("allows retry after admission policy changes from denied to open signup", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(storage.storage);
    const lookupInput = createSessionPrincipalLookupInput({
      email: "operator@allowed.example",
    });

    await writeAdmissionPolicy(authority, authorization, {
      allowedEmailDomain: ["allowed.example"],
      bootstrapMode: core.admissionBootstrapMode.values.manual.id,
      signupPolicy: core.admissionSignupPolicy.values.closed.id,
    });

    await expect(authority.lookupSessionPrincipal(lookupInput)).rejects.toMatchObject({
      reason: "denied",
      status: 403,
    });

    await writeAdmissionPolicy(authority, authorization, {
      allowedEmailDomain: ["allowed.example"],
      bootstrapMode: core.admissionBootstrapMode.values.manual.id,
      signupPolicy: core.admissionSignupPolicy.values.open.id,
    });

    const repaired = await authority.lookupSessionPrincipal(lookupInput);

    expect(repaired).toMatchObject({
      principalKind: "human",
      roleKeys: [],
      capabilityGrantIds: [],
      capabilityVersion: 0,
    });
    expect(readProductGraph(authority, authorization).principalRoleBinding.list()).toHaveLength(0);
  });

  it("keeps admitted principals unbound until initial role binding runs explicitly", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(storage.storage);
    const lookupInput = createSessionPrincipalLookupInput({
      email: "approved@example.com",
    });

    await authority.executeCommand(
      {
        kind: "set-admission-approval",
        input: {
          email: lookupInput.email ?? "approved@example.com",
          graphId: lookupInput.graphId,
          roleKeys: ["graph:member"],
        },
      },
      { authorization },
    );

    const projection = await authority.lookupSessionPrincipal(lookupInput);

    expect(projection).toMatchObject({
      principalKind: "human",
      roleKeys: [],
      capabilityVersion: 0,
    });
    expect(readProductGraph(authority, authorization).principalRoleBinding.list()).toHaveLength(0);
  });

  it("activates member role bindings explicitly for admitted principals", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(storage.storage);
    const lookupInput = createSessionPrincipalLookupInput({
      email: "approved@example.com",
    });

    await authority.executeCommand(
      {
        kind: "set-admission-approval",
        input: {
          email: lookupInput.email ?? "approved@example.com",
          graphId: lookupInput.graphId,
          roleKeys: ["graph:member"],
        },
      },
      { authorization },
    );
    await authority.lookupSessionPrincipal(lookupInput);

    const projection = await authority.activateSessionPrincipalRoleBindings(lookupInput);

    expect(projection).toMatchObject({
      principalKind: "human",
      roleKeys: ["graph:member"],
      capabilityVersion: 1,
    });
    expect(readProductGraph(authority, authorization).principalRoleBinding.list()).toHaveLength(1);
  });

  it("bootstraps the first operator through explicit admission plus explicit role binding", async () => {
    const bootstrapAuthorization = createAnonymousAuthorizationContext({
      graphId: "graph:test",
      policyVersion: 0,
    });
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(storage.storage);
    const lookupInput = createSessionPrincipalLookupInput({
      email: "operator@example.com",
    });

    const bootstrapped = await authority.executeCommand(
      {
        kind: "bootstrap-operator-access",
        input: {
          email: lookupInput.email ?? "operator@example.com",
          graphId: lookupInput.graphId,
        },
      },
      { authorization: bootstrapAuthorization },
    );
    const admitted = await authority.lookupSessionPrincipal(lookupInput);
    const projection = await authority.activateSessionPrincipalRoleBindings(lookupInput);
    const productGraphClient = readProductGraph(
      authority,
      createAuthorityAuthorizationContext({ graphId: lookupInput.graphId }),
    );

    expect(bootstrapped).toMatchObject({
      created: true,
      email: "operator@example.com",
      graphId: lookupInput.graphId,
      roleKeys: ["graph:authority", "graph:owner"],
    });
    expect(productGraphClient.admissionPolicy.list()).toMatchObject([
      expect.objectContaining({
        bootstrapMode: core.admissionBootstrapMode.values.manual.id,
        graphId: lookupInput.graphId,
        signupPolicy: core.admissionSignupPolicy.values.closed.id,
      }),
    ]);
    expect(productGraphClient.admissionApproval.list()).toMatchObject([
      expect.objectContaining({
        email: "operator@example.com",
        graphId: lookupInput.graphId,
        roleKey: ["graph:authority", "graph:owner"],
        status: core.admissionApprovalStatus.values.active.id,
      }),
    ]);
    expect(admitted).toMatchObject({
      principalKind: "human",
      roleKeys: [],
      capabilityVersion: 0,
    });
    expect(projection).toMatchObject({
      principalKind: "human",
      roleKeys: ["graph:authority", "graph:owner"],
      capabilityVersion: 1,
    });
  });

  it("lets operators manage explicit admission approvals separately from explicit role binding", async () => {
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(storage.storage);
    const lookupInput = createSessionPrincipalLookupInput({
      email: "approved@example.com",
    });

    const granted = await authority.executeCommand(
      {
        kind: "set-admission-approval",
        input: {
          email: lookupInput.email ?? "approved@example.com",
          graphId: lookupInput.graphId,
          roleKeys: ["graph:member"],
        },
      },
      { authorization: createAuthorityAuthorizationContext({ graphId: lookupInput.graphId }) },
    );
    const admitted = await authority.lookupSessionPrincipal(lookupInput);
    const projection = await authority.activateSessionPrincipalRoleBindings(lookupInput);
    const revoked = await authority.executeCommand(
      {
        kind: "set-admission-approval",
        input: {
          email: lookupInput.email ?? "approved@example.com",
          graphId: lookupInput.graphId,
          status: "revoked",
        },
      },
      { authorization: createAuthorityAuthorizationContext({ graphId: lookupInput.graphId }) },
    );

    expect(granted).toMatchObject({
      created: true,
      email: "approved@example.com",
      graphId: lookupInput.graphId,
      roleKeys: ["graph:member"],
      status: "active",
    });
    expect(admitted).toMatchObject({
      principalKind: "human",
      roleKeys: [],
      capabilityVersion: 0,
    });
    expect(projection).toMatchObject({
      principalKind: "human",
      roleKeys: ["graph:member"],
      capabilityVersion: 1,
    });
    expect(revoked).toMatchObject({
      created: false,
      email: "approved@example.com",
      roleKeys: [],
      status: "revoked",
    });
  });

  it("projects active principal-target capability grants and bumps capabilityVersion once per grant transaction", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(storage.storage);
    const lookupInput = createSessionPrincipalLookupInput();
    const initialProjection = await authority.lookupSessionPrincipal(lookupInput);
    const { mutationGraph, mutationStore } = createProductMutationStore(
      authority.readSnapshot({ authorization }),
    );
    const beforeCreate = mutationStore.snapshot();
    const firstGrantId = mutationGraph.capabilityGrant.create({
      grantedByPrincipal: initialProjection.principalId,
      name: "Principal predicate read grant",
      resourceKind: core.capabilityGrantResourceKind.values.predicateRead.id,
      resourcePredicateId: envVarDescriptionPredicateId,
      status: core.capabilityGrantStatus.values.active.id,
      targetKind: core.capabilityGrantTargetKind.values.principal.id,
      targetPrincipal: initialProjection.principalId,
    });
    mutationGraph.capabilityGrant.create({
      grantedByPrincipal: initialProjection.principalId,
      name: "Graph-wide preview grant",
      resourceKind: core.capabilityGrantResourceKind.values.shareSurface.id,
      resourceSurfaceId: "surface:graph-preview",
      status: core.capabilityGrantStatus.values.active.id,
      targetGraphId: lookupInput.graphId,
      targetKind: core.capabilityGrantTargetKind.values.graph.id,
    });
    mutationGraph.capabilityGrant.create({
      bearerTokenHash: "token-hash-1",
      grantedByPrincipal: initialProjection.principalId,
      name: "Bearer preview grant",
      resourceKind: core.capabilityGrantResourceKind.values.shareSurface.id,
      resourceSurfaceId: "surface:bearer-preview",
      status: core.capabilityGrantStatus.values.active.id,
      targetKind: core.capabilityGrantTargetKind.values.bearer.id,
    });

    await authority.applyTransaction(
      buildGraphWriteTransaction(
        beforeCreate,
        mutationStore.snapshot(),
        "tx:create-capability-grants",
      ),
      {
        authorization,
        writeScope: "authority-only",
      },
    );

    const afterCreate = await authority.lookupSessionPrincipal(lookupInput);

    expect(afterCreate.capabilityGrantIds).toEqual([firstGrantId]);
    expect(afterCreate.capabilityVersion).toBe(1);
    expect(
      readProductGraph(authority, authorization).principal.get(initialProjection.principalId),
    ).toMatchObject({
      capabilityVersion: 1,
    });

    const { mutationGraph: revokeGraph, mutationStore: revokeStore } = createProductMutationStore(
      authority.readSnapshot({ authorization }),
    );
    const beforeRevoke = revokeStore.snapshot();
    revokeGraph.capabilityGrant.update(firstGrantId, {
      revokedAt: new Date("2026-03-24T01:00:00.000Z"),
      status: core.capabilityGrantStatus.values.revoked.id,
    });

    await authority.applyTransaction(
      buildGraphWriteTransaction(
        beforeRevoke,
        revokeStore.snapshot(),
        "tx:revoke-capability-grant",
      ),
      {
        authorization,
        writeScope: "authority-only",
      },
    );

    const afterRevoke = await authority.lookupSessionPrincipal(lookupInput);

    expect(afterRevoke.capabilityGrantIds).toEqual([]);
    expect(afterRevoke.capabilityVersion).toBe(2);

    const { mutationGraph: reissueGraph, mutationStore: reissueStore } = createProductMutationStore(
      authority.readSnapshot({ authorization }),
    );
    const beforeReissue = reissueStore.snapshot();
    const secondGrantId = reissueGraph.capabilityGrant.create({
      grantedByPrincipal: initialProjection.principalId,
      name: "Principal predicate read grant",
      resourceKind: core.capabilityGrantResourceKind.values.predicateRead.id,
      resourcePredicateId: envVarDescriptionPredicateId,
      status: core.capabilityGrantStatus.values.active.id,
      targetKind: core.capabilityGrantTargetKind.values.principal.id,
      targetPrincipal: initialProjection.principalId,
    });

    await authority.applyTransaction(
      buildGraphWriteTransaction(
        beforeReissue,
        reissueStore.snapshot(),
        "tx:reissue-capability-grant",
      ),
      {
        authorization,
        writeScope: "authority-only",
      },
    );

    const afterReissue = await authority.lookupSessionPrincipal(lookupInput);

    expect(secondGrantId).not.toBe(firstGrantId);
    expect(afterReissue.capabilityGrantIds).toEqual([secondGrantId]);
    expect(afterReissue.capabilityVersion).toBe(3);
  });

  it("projects principal-target module-permission grants through the same authority grant path", async () => {
    const authorization = createAuthorityAuthorizationContext();
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(storage.storage);
    const lookupInput = createSessionPrincipalLookupInput();
    const initialProjection = await authority.lookupSessionPrincipal(lookupInput);
    const { mutationGraph, mutationStore } = createProductMutationStore(
      authority.readSnapshot({ authorization }),
    );
    const beforeCreate = mutationStore.snapshot();
    const modulePermissionGrantId = mutationGraph.capabilityGrant.create({
      grantedByPrincipal: initialProjection.principalId,
      name: "Module summary read approval",
      resourceKind: core.capabilityGrantResourceKind.values.modulePermission.id,
      resourcePermissionKey: "probe.contract.read.summary",
      status: core.capabilityGrantStatus.values.active.id,
      targetKind: core.capabilityGrantTargetKind.values.principal.id,
      targetPrincipal: initialProjection.principalId,
    });

    await authority.applyTransaction(
      buildGraphWriteTransaction(
        beforeCreate,
        mutationStore.snapshot(),
        "tx:create-module-permission-grant",
      ),
      {
        authorization,
        writeScope: "authority-only",
      },
    );

    const afterCreate = await authority.lookupSessionPrincipal(lookupInput);

    expect(afterCreate.capabilityGrantIds).toEqual([modulePermissionGrantId]);
    expect(afterCreate.capabilityVersion).toBe(1);
  });

  it("fails closed when the authorization context capabilityVersion is stale", async () => {
    const authorityAuthorization = createAuthorityAuthorizationContext();
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(storage.storage);
    const lookupInput = createSessionPrincipalLookupInput();
    const initialProjection = await authority.lookupSessionPrincipal(lookupInput);
    const signedInAuthorization = createTestAuthorizationContext({
      graphId: lookupInput.graphId,
      principalId: initialProjection.principalId,
      principalKind: initialProjection.principalKind,
      sessionId: "session:browser",
      roleKeys: [...(initialProjection.roleKeys ?? [])],
      capabilityGrantIds: [...(initialProjection.capabilityGrantIds ?? [])],
      capabilityVersion: initialProjection.capabilityVersion,
    });
    const { mutationGraph, mutationStore } = createProductMutationStore(
      authority.readSnapshot({ authorization: authorityAuthorization }),
    );
    const beforeGrant = mutationStore.snapshot();

    mutationGraph.capabilityGrant.create({
      grantedByPrincipal: initialProjection.principalId,
      name: "Stale capability grant",
      resourceKind: core.capabilityGrantResourceKind.values.predicateRead.id,
      resourcePredicateId: envVarDescriptionPredicateId,
      status: core.capabilityGrantStatus.values.active.id,
      targetKind: core.capabilityGrantTargetKind.values.principal.id,
      targetPrincipal: initialProjection.principalId,
    });

    await authority.applyTransaction(
      buildGraphWriteTransaction(
        beforeGrant,
        mutationStore.snapshot(),
        "tx:create-stale-capability-grant",
      ),
      {
        authorization: authorityAuthorization,
        writeScope: "authority-only",
      },
    );

    expect(() =>
      authority.createSyncPayload({
        authorization: signedInAuthorization,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "policy.stale_context",
        message: expect.stringContaining("capability version"),
        status: 409,
      }),
    );

    const refreshedProjection = await authority.lookupSessionPrincipal(lookupInput);

    expect(refreshedProjection.capabilityVersion).toBe(1);
    expect(
      authority.createSyncPayload({
        authorization: createTestAuthorizationContext({
          graphId: lookupInput.graphId,
          principalId: refreshedProjection.principalId,
          principalKind: refreshedProjection.principalKind,
          sessionId: "session:browser",
          roleKeys: [...(refreshedProjection.roleKeys ?? [])],
          capabilityGrantIds: [...(refreshedProjection.capabilityGrantIds ?? [])],
          capabilityVersion: refreshedProjection.capabilityVersion,
        }),
      }).mode,
    ).toBe("total");
  });

  it("unlocks capability-gated predicate reads from principal-target grants", async () => {
    const authorityAuthorization = createAuthorityAuthorizationContext();
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(storage.storage, {
      graph: capabilityGraph,
    });
    const lookupInput = createSessionPrincipalLookupInput();
    const initialProjection = await authority.lookupSessionPrincipal(lookupInput);
    const { mutationGraph, mutationStore } = createMutationStoreForGraph(
      authority.readSnapshot({ authorization: authorityAuthorization }),
      capabilityGraph,
    );
    const beforeCreate = mutationStore.snapshot();
    const noteId = mutationGraph.capabilityNote.create({});

    await authority.applyTransaction(
      buildGraphWriteTransaction(
        beforeCreate,
        mutationStore.snapshot(),
        "tx:create-capability-gated-note",
      ),
      {
        authorization: authorityAuthorization,
        writeScope: "authority-only",
      },
    );
    const { mutationGraph: seedSetupGraph, mutationStore: seedSetupStore } =
      createProductMutationStore(authority.readSnapshot({ authorization: authorityAuthorization }));
    const beforeSeedSetup = seedSetupStore.snapshot();
    seedSetupGraph.principalRoleBinding.create({
      name: "Capability note authority seed role",
      principal: initialProjection.principalId,
      roleKey: "graph:authority",
      status: core.principalRoleBindingStatus.values.active.id,
    });
    seedSetupGraph.capabilityGrant.create({
      grantedByPrincipal: initialProjection.principalId,
      name: "Capability note seed write grant",
      resourceKind: core.capabilityGrantResourceKind.values.predicateWrite.id,
      resourcePredicateId: capabilityReadNotePredicateId,
      status: core.capabilityGrantStatus.values.active.id,
      targetKind: core.capabilityGrantTargetKind.values.principal.id,
      targetPrincipal: initialProjection.principalId,
    });

    await authority.applyTransaction(
      buildGraphWriteTransaction(
        beforeSeedSetup,
        seedSetupStore.snapshot(),
        "tx:grant-capability-gated-note-seed-write",
      ),
      {
        authorization: authorityAuthorization,
        writeScope: "authority-only",
      },
    );
    const seededProjection = await authority.lookupSessionPrincipal(lookupInput);
    const seededAuthorization = createProjectedAuthorizationContext(lookupInput, seededProjection);
    const { mutationGraph: seedGraph, mutationStore: seedStore } = createMutationStoreForGraph(
      authority.readSnapshot({ authorization: authorityAuthorization }),
      capabilityGraph,
    );
    const beforeSeedWrite = seedStore.snapshot();
    seedGraph.capabilityNote.update(noteId, {
      readNote: "Capability-gated note",
    });

    await authority.applyTransaction(
      buildGraphWriteTransaction(
        beforeSeedWrite,
        seedStore.snapshot(),
        "tx:seed-capability-gated-note",
      ),
      {
        authorization: seededAuthorization,
        writeScope: "authority-only",
      },
    );
    const deniedTotal = authority.createSyncPayload({
      authorization: seededAuthorization,
    });

    expect(
      deniedTotal.snapshot.edges.some(
        (edge) => edge.s === noteId && edge.p === capabilityReadNotePredicateId,
      ),
    ).toBe(false);
    expect(() =>
      authority.readPredicateValue(noteId, capabilityReadNotePredicateId, {
        authorization: seededAuthorization,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "policy.read.forbidden",
        status: 403,
      }),
    );

    const { mutationGraph: readGrantGraph, mutationStore: readGrantStore } =
      createProductMutationStore(authority.readSnapshot({ authorization: authorityAuthorization }));
    const beforeReadGrant = readGrantStore.snapshot();
    readGrantGraph.capabilityGrant.create({
      grantedByPrincipal: initialProjection.principalId,
      name: "Capability note read grant",
      resourceKind: core.capabilityGrantResourceKind.values.predicateRead.id,
      resourcePredicateId: capabilityReadNotePredicateId,
      status: core.capabilityGrantStatus.values.active.id,
      targetKind: core.capabilityGrantTargetKind.values.principal.id,
      targetPrincipal: initialProjection.principalId,
    });

    await authority.applyTransaction(
      buildGraphWriteTransaction(
        beforeReadGrant,
        readGrantStore.snapshot(),
        "tx:grant-capability-gated-note-read",
      ),
      {
        authorization: authorityAuthorization,
        writeScope: "authority-only",
      },
    );

    const refreshedProjection = await authority.lookupSessionPrincipal(lookupInput);
    const refreshedAuthorization = createProjectedAuthorizationContext(
      lookupInput,
      refreshedProjection,
    );
    const grantedTotal = authority.createSyncPayload({
      authorization: refreshedAuthorization,
    });

    expect(
      grantedTotal.snapshot.edges.some(
        (edge) =>
          edge.s === noteId &&
          edge.p === capabilityReadNotePredicateId &&
          edge.o === "Capability-gated note",
      ),
    ).toBe(true);
    expect(
      authority.readPredicateValue(noteId, capabilityReadNotePredicateId, {
        authorization: refreshedAuthorization,
      }),
    ).toBe("Capability-gated note");
  });

  it("applies principal-target share grants to delegated sync and direct reads", async () => {
    const authorityAuthorization = createAuthorityAuthorizationContext();
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(storage.storage, {
      graph: shareProofGraph,
    });
    const ownerLookupInput = createSessionPrincipalLookupInput();
    const delegateLookupInput = createSessionPrincipalLookupInput({
      subject: {
        providerAccountId: "user-2",
        authUserId: "auth-user-2",
      },
    });
    const ownerProjection = await authority.lookupSessionPrincipal(ownerLookupInput);
    const initialDelegateProjection = await authority.lookupSessionPrincipal(delegateLookupInput);
    const { mutationGraph: createGraph, mutationStore: createStore } = createMutationStoreForGraph(
      authority.readSnapshot({ authorization: authorityAuthorization }),
      shareProofGraph,
    );
    const beforeCreate = createStore.snapshot();
    const noteId = createGraph.shareProbe.create({
      name: "Delegated share proof",
      sharedNote: "Shared before grant",
      privateNote: "Always private",
    });

    await authority.applyTransaction(
      buildGraphWriteTransaction(
        beforeCreate,
        createStore.snapshot(),
        "tx:create-delegated-share-note",
      ),
      {
        authorization: authorityAuthorization,
        writeScope: "authority-only",
      },
    );

    const initialDelegateAuthorization = createProjectedAuthorizationContext(
      delegateLookupInput,
      initialDelegateProjection,
    );
    const deniedTotal = authority.createSyncPayload({
      authorization: initialDelegateAuthorization,
    });

    expect(
      deniedTotal.snapshot.edges.some(
        (edge) =>
          edge.s === noteId &&
          (edge.p === shareProbeSharedNotePredicateId ||
            edge.p === shareProbePrivateNotePredicateId),
      ),
    ).toBe(false);
    expect(() =>
      authority.readPredicateValue(noteId, shareProbeSharedNotePredicateId, {
        authorization: initialDelegateAuthorization,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "policy.read.forbidden",
        status: 403,
      }),
    );

    const { mutationGraph: grantGraph, mutationStore: grantStore } = createMutationStoreForGraph(
      authority.readSnapshot({ authorization: authorityAuthorization }),
      shareProofGraph,
    );
    const beforeGrant = grantStore.snapshot();
    const shareSurfaceId = "surface:share-probe:shared-note";
    const capabilityGrantId = grantGraph.capabilityGrant.create({
      grantedByPrincipal: ownerProjection.principalId,
      name: "Delegated shared note read",
      resourceKind: core.capabilityGrantResourceKind.values.shareSurface.id,
      resourceSurfaceId: shareSurfaceId,
      constraintRootEntityId: noteId,
      constraintPredicateId: [shareProbeSharedNotePredicateId],
      status: core.capabilityGrantStatus.values.active.id,
      targetKind: core.capabilityGrantTargetKind.values.principal.id,
      targetPrincipal: initialDelegateProjection.principalId,
    });
    const shareGrantId = grantGraph.shareGrant.create({
      capabilityGrant: capabilityGrantId,
      name: "Delegated share grant",
      status: core.capabilityGrantStatus.values.active.id,
      surfaceId: shareSurfaceId,
      surfaceKind: core.shareSurfaceKind.values.entityPredicateSlice.id,
      surfacePredicateId: [shareProbeSharedNotePredicateId],
      surfaceRootEntityId: noteId,
    });

    await authority.applyTransaction(
      buildGraphWriteTransaction(beforeGrant, grantStore.snapshot(), "tx:grant-shared-note-read"),
      {
        authorization: authorityAuthorization,
        writeScope: "authority-only",
      },
    );

    const refreshedDelegateProjection = await authority.lookupSessionPrincipal(delegateLookupInput);
    expect(refreshedDelegateProjection.summary.access).toEqual({
      authority: false,
      graphMember: false,
      sharedRead: true,
    });
    const refreshedDelegateAuthorization = createProjectedAuthorizationContext(
      delegateLookupInput,
      refreshedDelegateProjection,
    );
    const grantedTotal = authority.createSyncPayload({
      authorization: refreshedDelegateAuthorization,
    });
    const grantedIncremental = authority.getIncrementalSyncResult(deniedTotal.cursor, {
      authorization: refreshedDelegateAuthorization,
    });

    expect(
      grantedTotal.snapshot.edges.some(
        (edge) =>
          edge.s === noteId &&
          edge.p === shareProbeSharedNotePredicateId &&
          edge.o === "Shared before grant",
      ),
    ).toBe(true);
    expect(
      grantedTotal.snapshot.edges.some(
        (edge) => edge.s === noteId && edge.p === shareProbePrivateNotePredicateId,
      ),
    ).toBe(false);
    expect(grantedIncremental).toMatchObject({
      mode: "incremental",
      after: deniedTotal.cursor,
      cursor: grantedTotal.cursor,
      fallback: "reset",
    });
    expect(
      readStringPredicateValue(
        authority,
        refreshedDelegateAuthorization,
        noteId,
        shareProbeSharedNotePredicateId,
      ),
    ).toBe("Shared before grant");
    expect(() =>
      authority.readPredicateValue(noteId, shareProbePrivateNotePredicateId, {
        authorization: refreshedDelegateAuthorization,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "policy.read.forbidden",
        status: 403,
      }),
    );

    const { mutationGraph: revokeGraph, mutationStore: revokeStore } = createMutationStoreForGraph(
      authority.readSnapshot({ authorization: authorityAuthorization }),
      shareProofGraph,
    );
    const beforeRevoke = revokeStore.snapshot();
    revokeGraph.shareGrant.update(shareGrantId, {
      status: core.capabilityGrantStatus.values.revoked.id,
    });

    await authority.applyTransaction(
      buildGraphWriteTransaction(
        beforeRevoke,
        revokeStore.snapshot(),
        "tx:revoke-shared-note-read",
      ),
      {
        authorization: authorityAuthorization,
        writeScope: "authority-only",
      },
    );

    const revokedTotal = authority.createSyncPayload({
      authorization: refreshedDelegateAuthorization,
    });
    const revokedIncremental = authority.getIncrementalSyncResult(grantedTotal.cursor, {
      authorization: refreshedDelegateAuthorization,
    });

    expect(
      revokedTotal.snapshot.edges.some(
        (edge) =>
          edge.s === noteId &&
          (edge.p === shareProbeSharedNotePredicateId ||
            edge.p === shareProbePrivateNotePredicateId),
      ),
    ).toBe(false);
    expect(revokedIncremental).toMatchObject({
      mode: "incremental",
      after: grantedTotal.cursor,
      cursor: revokedTotal.cursor,
      fallback: "reset",
    });
    expect(() =>
      authority.readPredicateValue(noteId, shareProbeSharedNotePredicateId, {
        authorization: refreshedDelegateAuthorization,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "policy.read.forbidden",
        status: 403,
      }),
    );
  });

  it("applies bearer-token share grants through hashed lookup, expiry, and revocation", async () => {
    const authorityAuthorization = createAuthorityAuthorizationContext();
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(storage.storage, {
      graph: shareProofGraph,
    });
    const ownerLookupInput = createSessionPrincipalLookupInput();
    const ownerProjection = await authority.lookupSessionPrincipal(ownerLookupInput);
    const issued = await issueBearerShareToken();
    const { mutationGraph: createGraph, mutationStore: createStore } = createMutationStoreForGraph(
      authority.readSnapshot({ authorization: authorityAuthorization }),
      shareProofGraph,
    );
    const beforeCreate = createStore.snapshot();
    const noteId = createGraph.shareProbe.create({
      name: "Bearer share proof",
      sharedNote: "Shared by bearer",
      privateNote: "Still private",
    });

    await authority.applyTransaction(
      buildGraphWriteTransaction(beforeCreate, createStore.snapshot(), "tx:create-bearer-share"),
      {
        authorization: authorityAuthorization,
        writeScope: "authority-only",
      },
    );

    const { mutationGraph: grantGraph, mutationStore: grantStore } = createMutationStoreForGraph(
      authority.readSnapshot({ authorization: authorityAuthorization }),
      shareProofGraph,
    );
    const beforeGrant = grantStore.snapshot();
    const shareSurfaceId = "surface:share-probe:bearer-shared-note";
    const capabilityGrantId = grantGraph.capabilityGrant.create({
      bearerTokenHash: issued.tokenHash,
      constraintExpiresAt: new Date(Date.now() + 60_000),
      constraintPredicateId: [shareProbeSharedNotePredicateId],
      constraintRootEntityId: noteId,
      grantedByPrincipal: ownerProjection.principalId,
      name: "Bearer shared note read",
      resourceKind: core.capabilityGrantResourceKind.values.shareSurface.id,
      resourceSurfaceId: shareSurfaceId,
      status: core.capabilityGrantStatus.values.active.id,
      targetKind: core.capabilityGrantTargetKind.values.bearer.id,
    });
    const shareGrantId = grantGraph.shareGrant.create({
      capabilityGrant: capabilityGrantId,
      name: "Bearer share grant",
      status: core.capabilityGrantStatus.values.active.id,
      surfaceId: shareSurfaceId,
      surfaceKind: core.shareSurfaceKind.values.entityPredicateSlice.id,
      surfacePredicateId: [shareProbeSharedNotePredicateId],
      surfaceRootEntityId: noteId,
    });

    await authority.applyTransaction(
      buildGraphWriteTransaction(
        beforeGrant,
        grantStore.snapshot(),
        "tx:grant-bearer-shared-note-read",
      ),
      {
        authorization: authorityAuthorization,
        writeScope: "authority-only",
      },
    );

    const bearerProjection = await authority.lookupBearerShare({
      graphId: "graph:test",
      tokenHash: issued.tokenHash,
    });
    const bearerAuthorization = createBearerAuthorizationContext(
      bearerProjection.capabilityGrantIds,
    );
    const grantedTotal = authority.createSyncPayload({
      authorization: bearerAuthorization,
    });

    expect(
      readProductGraph(authority, authorityAuthorization).capabilityGrant.get(capabilityGrantId),
    ).toMatchObject({
      bearerTokenHash: issued.tokenHash,
    });
    expect(
      grantedTotal.snapshot.edges.some(
        (edge) =>
          edge.s === noteId &&
          edge.p === shareProbeSharedNotePredicateId &&
          edge.o === "Shared by bearer",
      ),
    ).toBe(true);
    expect(
      grantedTotal.snapshot.edges.some(
        (edge) => edge.s === noteId && edge.p === shareProbePrivateNotePredicateId,
      ),
    ).toBe(false);
    expect(
      readStringPredicateValue(
        authority,
        bearerAuthorization,
        noteId,
        shareProbeSharedNotePredicateId,
      ),
    ).toBe("Shared by bearer");
    expect(() =>
      authority.readPredicateValue(noteId, shareProbePrivateNotePredicateId, {
        authorization: bearerAuthorization,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "auth.unauthenticated",
        status: 401,
      }),
    );

    const { mutationGraph: revokeGraph, mutationStore: revokeStore } = createMutationStoreForGraph(
      authority.readSnapshot({ authorization: authorityAuthorization }),
      shareProofGraph,
    );
    const beforeRevoke = revokeStore.snapshot();
    revokeGraph.shareGrant.update(shareGrantId, {
      status: core.capabilityGrantStatus.values.revoked.id,
    });

    await authority.applyTransaction(
      buildGraphWriteTransaction(
        beforeRevoke,
        revokeStore.snapshot(),
        "tx:revoke-bearer-shared-note-read",
      ),
      {
        authorization: authorityAuthorization,
        writeScope: "authority-only",
      },
    );

    const revokedIncremental = authority.getIncrementalSyncResult(grantedTotal.cursor, {
      authorization: bearerAuthorization,
    });

    expect(revokedIncremental).toMatchObject({
      mode: "incremental",
      after: grantedTotal.cursor,
      fallback: "reset",
    });
    await expect(
      authority.lookupBearerShare({
        graphId: "graph:test",
        tokenHash: issued.tokenHash,
      }),
    ).rejects.toMatchObject({
      code: "grant.invalid",
      reason: "revoked",
      status: 403,
    });
  });

  it("rejects expired bearer share tokens before reads continue", async () => {
    const authorityAuthorization = createAuthorityAuthorizationContext();
    const authority = await createTestWebAppAuthority(
      createInMemoryTestWebAppAuthorityStorage().storage,
      {
        graph: shareProofGraph,
      },
    );
    const ownerProjection = await authority.lookupSessionPrincipal(
      createSessionPrincipalLookupInput(),
    );
    const issued = await issueBearerShareToken();
    const { mutationGraph, mutationStore } = createMutationStoreForGraph(
      authority.readSnapshot({ authorization: authorityAuthorization }),
      shareProofGraph,
    );
    const beforeGrant = mutationStore.snapshot();
    const noteId = mutationGraph.shareProbe.create({
      name: "Expired bearer share proof",
      sharedNote: "Expired shared note",
    });
    const capabilityGrantId = mutationGraph.capabilityGrant.create({
      bearerTokenHash: issued.tokenHash,
      constraintExpiresAt: new Date(Date.now() - 60_000),
      constraintPredicateId: [shareProbeSharedNotePredicateId],
      constraintRootEntityId: noteId,
      grantedByPrincipal: ownerProjection.principalId,
      name: "Expired bearer shared note read",
      resourceKind: core.capabilityGrantResourceKind.values.shareSurface.id,
      resourceSurfaceId: "surface:share-probe:expired-bearer-shared-note",
      status: core.capabilityGrantStatus.values.active.id,
      targetKind: core.capabilityGrantTargetKind.values.bearer.id,
    });
    mutationGraph.shareGrant.create({
      capabilityGrant: capabilityGrantId,
      name: "Expired bearer share grant",
      status: core.capabilityGrantStatus.values.active.id,
      surfaceId: "surface:share-probe:expired-bearer-shared-note",
      surfaceKind: core.shareSurfaceKind.values.entityPredicateSlice.id,
      surfacePredicateId: [shareProbeSharedNotePredicateId],
      surfaceRootEntityId: noteId,
    });

    await authority.applyTransaction(
      buildGraphWriteTransaction(
        beforeGrant,
        mutationStore.snapshot(),
        "tx:grant-expired-bearer-shared-note-read",
      ),
      {
        authorization: authorityAuthorization,
        writeScope: "authority-only",
      },
    );

    await expect(
      authority.lookupBearerShare({
        graphId: "graph:test",
        tokenHash: issued.tokenHash,
      }),
    ).rejects.toMatchObject({
      code: "grant.invalid",
      reason: "expired",
      status: 403,
    });
  });

  it("unlocks capability-gated writes from principal-target grants", async () => {
    const authorityAuthorization = createAuthorityAuthorizationContext();
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(storage.storage, {
      graph: capabilityGraph,
    });
    const lookupInput = createSessionPrincipalLookupInput();
    const initialProjection = await authority.lookupSessionPrincipal(lookupInput);
    const signedInAuthorization = createProjectedAuthorizationContext(
      lookupInput,
      initialProjection,
    );
    const { mutationGraph, mutationStore } = createMutationStoreForGraph(
      authority.readSnapshot({ authorization: authorityAuthorization }),
      capabilityGraph,
    );
    const beforeCreate = mutationStore.snapshot();
    const noteId = mutationGraph.capabilityNote.create({});

    await authority.applyTransaction(
      buildGraphWriteTransaction(
        beforeCreate,
        mutationStore.snapshot(),
        "tx:create-capability-write-note",
      ),
      {
        authorization: authorityAuthorization,
        writeScope: "authority-only",
      },
    );

    const { mutationGraph: deniedGraph, mutationStore: deniedStore } = createMutationStoreForGraph(
      authority.readSnapshot({ authorization: authorityAuthorization }),
      capabilityGraph,
    );
    const beforeDeniedWrite = deniedStore.snapshot();
    deniedGraph.capabilityNote.update(noteId, {
      writeNote: "Denied capability write",
    });

    await expect(
      authority.applyTransaction(
        buildGraphWriteTransaction(
          beforeDeniedWrite,
          deniedStore.snapshot(),
          "tx:deny-capability-gated-write",
        ),
        {
          authorization: signedInAuthorization,
        },
      ),
    ).rejects.toMatchObject({
      result: expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: "policy.write.forbidden",
          }),
        ]),
      }),
    });

    const { mutationGraph: grantGraph, mutationStore: grantStore } = createProductMutationStore(
      authority.readSnapshot({ authorization: authorityAuthorization }),
    );
    const beforeGrant = grantStore.snapshot();
    grantGraph.capabilityGrant.create({
      grantedByPrincipal: initialProjection.principalId,
      name: "Capability note write grant",
      resourceKind: core.capabilityGrantResourceKind.values.predicateWrite.id,
      resourcePredicateId: capabilityWriteNotePredicateId,
      status: core.capabilityGrantStatus.values.active.id,
      targetKind: core.capabilityGrantTargetKind.values.principal.id,
      targetPrincipal: initialProjection.principalId,
    });

    await authority.applyTransaction(
      buildGraphWriteTransaction(
        beforeGrant,
        grantStore.snapshot(),
        "tx:grant-capability-gated-write",
      ),
      {
        authorization: authorityAuthorization,
        writeScope: "authority-only",
      },
    );

    const refreshedProjection = await authority.lookupSessionPrincipal(lookupInput);
    const refreshedAuthorization = createProjectedAuthorizationContext(
      lookupInput,
      refreshedProjection,
    );
    const { mutationGraph: allowedGraph, mutationStore: allowedStore } =
      createMutationStoreForGraph(
        authority.readSnapshot({ authorization: authorityAuthorization }),
        capabilityGraph,
      );
    const beforeAllowedWrite = allowedStore.snapshot();
    allowedGraph.capabilityNote.update(noteId, {
      writeNote: "Allowed capability write",
    });

    await authority.applyTransaction(
      buildGraphWriteTransaction(
        beforeAllowedWrite,
        allowedStore.snapshot(),
        "tx:allow-capability-gated-write",
      ),
      {
        authorization: refreshedAuthorization,
      },
    );

    expect(() =>
      authority.readPredicateValue(noteId, capabilityWriteNotePredicateId, {
        authorization: refreshedAuthorization,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "policy.read.forbidden",
        status: 403,
      }),
    );

    const { mutationGraph: readGrantGraph, mutationStore: readGrantStore } =
      createProductMutationStore(authority.readSnapshot({ authorization: authorityAuthorization }));
    const beforeReadGrant = readGrantStore.snapshot();
    readGrantGraph.capabilityGrant.create({
      grantedByPrincipal: initialProjection.principalId,
      name: "Capability note write readback grant",
      resourceKind: core.capabilityGrantResourceKind.values.predicateRead.id,
      resourcePredicateId: capabilityWriteNotePredicateId,
      status: core.capabilityGrantStatus.values.active.id,
      targetKind: core.capabilityGrantTargetKind.values.principal.id,
      targetPrincipal: initialProjection.principalId,
    });

    await authority.applyTransaction(
      buildGraphWriteTransaction(
        beforeReadGrant,
        readGrantStore.snapshot(),
        "tx:grant-capability-gated-write-readback",
      ),
      {
        authorization: authorityAuthorization,
        writeScope: "authority-only",
      },
    );

    const readableProjection = await authority.lookupSessionPrincipal(lookupInput);
    const readableAuthorization = createProjectedAuthorizationContext(
      lookupInput,
      readableProjection,
    );
    expect(
      readStringPredicateValue(
        authority,
        readableAuthorization,
        noteId,
        capabilityWriteNotePredicateId,
      ),
    ).toBe("Allowed capability write");
  });

  it("allows graph-member predicate edits when lifecycle-managed updatedAt is included", async () => {
    const authorityAuthorization = createAuthorityAuthorizationContext();
    const memberAuthorization = createHumanAuthorizationContext();
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createTestWebAppAuthority(storage.storage, {
      graph: editableNoteGraph,
    });
    const { mutationGraph: seedGraph, mutationStore: seedStore } = createMutationStoreForGraph(
      authority.readSnapshot({ authorization: authorityAuthorization }),
      editableNoteGraph,
    );
    const beforeCreate = seedStore.snapshot();
    const noteId = seedGraph.editableNote.create({
      name: "Original note",
    });

    await authority.applyTransaction(
      buildGraphWriteTransaction(beforeCreate, seedStore.snapshot(), "tx:create-editable-note"),
      {
        authorization: authorityAuthorization,
        writeScope: "authority-only",
      },
    );

    const { mutationGraph, mutationStore } = createMutationStoreForGraph(
      authority.readSnapshot({ authorization: authorityAuthorization }),
      editableNoteGraph,
    );
    const beforeUpdate = mutationStore.snapshot();
    mutationGraph.editableNote.update(noteId, {
      name: "Renamed note",
    });
    const transaction = buildGraphWriteTransaction(
      beforeUpdate,
      mutationStore.snapshot(),
      "tx:update-editable-note-name",
    );

    expect(
      transaction.ops.some(
        (operation) =>
          operation.op === "assert" && operation.edge.p === edgeId(core.node.fields.updatedAt),
      ),
    ).toBe(true);

    await expect(
      authority.applyTransaction(transaction, {
        authorization: memberAuthorization,
      }),
    ).resolves.toMatchObject({
      replayed: false,
      txId: "tx:update-editable-note-name",
      writeScope: "client-tx",
    });

    expect(
      authority
        .readSnapshot({ authorization: authorityAuthorization })
        .edges.some(
          (edge) =>
            edge.s === noteId &&
            edge.p === edgeId(core.node.fields.name) &&
            edge.o === "Renamed note",
        ),
    ).toBe(true);
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
