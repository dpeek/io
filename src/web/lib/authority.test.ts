import { describe, expect, it } from "bun:test";

import {
  bootstrap,
  createStore,
  createTypeClient,
  edgeId,
  type GraphWriteTransaction,
  type StoreSnapshot,
} from "@io/core/graph";
import { core } from "@io/core/graph/modules";
import { ops } from "@io/core/graph/modules/ops";
import { pkm } from "@io/core/graph/modules/pkm";

import { createInMemoryTestWebAppAuthorityStorage } from "./authority-test-storage.js";
import { createWebAppAuthority } from "./authority.js";
import { handleSecretFieldRequest } from "./server-routes.js";

const productGraph = { ...core, ...pkm, ...ops } as const;
const envVarSecretPredicateId = edgeId(ops.envVar.fields.secret);

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

describe("web authority", () => {
  it("stores secret plaintext outside sync and reloads it across restart", async () => {
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createWebAppAuthority(storage.storage);
    const envVarId = authority.graph.envVar.create({
      description: "Primary model credential",
      name: "OPENAI_API_KEY",
    });

    const created = await authority.writeSecretField({
      entityId: envVarId,
      predicateId: envVarSecretPredicateId,
      plaintext: "sk-live-first",
    });
    const createdSecretId = authority.graph.envVar.get(envVarId).secret;
    if (!createdSecretId) throw new Error("Expected created env var secret.");

    expect(created.created).toBe(true);
    expect(created.rotated).toBe(false);
    expect(created.secretVersion).toBe(1);
    expect(JSON.stringify(authority.createSyncPayload())).not.toContain("sk-live-first");
    expect(storage.read()?.secrets?.[createdSecretId]?.value).toBe("sk-live-first");
    expect(
      storage
        .read()
        ?.writeHistory.results.at(-1)
        ?.txId.startsWith(`secret-field:${envVarId}:${envVarSecretPredicateId}:`),
    ).toBe(true);
    expect(storage.read()?.writeHistory.results.at(-1)?.writeScope).toBe("server-command");

    const rotated = await authority.writeSecretField({
      entityId: envVarId,
      predicateId: envVarSecretPredicateId,
      plaintext: "sk-live-second",
    });
    const restarted = await createWebAppAuthority(storage.storage);
    const restartedSecretId = restarted.graph.envVar.get(envVarId).secret;
    if (!restartedSecretId) throw new Error("Expected restarted env var secret.");

    expect(rotated.created).toBe(false);
    expect(rotated.rotated).toBe(true);
    expect(rotated.secretVersion).toBe(2);
    expect(storage.read()?.secrets?.[createdSecretId]?.value).toBe("sk-live-second");
    expect(restartedSecretId).toBe(createdSecretId);
    expect(restarted.graph.secretHandle.get(restartedSecretId)?.version).toBe(2);
    expect(JSON.stringify(restarted.createSyncPayload())).not.toContain("sk-live-second");

    const confirmed = await restarted.writeSecretField({
      entityId: envVarId,
      predicateId: envVarSecretPredicateId,
      plaintext: "sk-live-second",
    });

    expect(confirmed).toMatchObject({
      created: false,
      rotated: false,
      secretId: createdSecretId,
      secretVersion: 2,
    });
  });

  it("rejects ordinary transactions that directly rewrite secret-backed refs", async () => {
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createWebAppAuthority(storage.storage);

    const primaryEnvVarId = authority.graph.envVar.create({
      description: "Primary model credential",
      name: "OPENAI_API_KEY",
    });
    const secondaryEnvVarId = authority.graph.envVar.create({
      description: "Notifications integration",
      name: "SLACK_BOT_TOKEN",
    });

    await authority.writeSecretField({
      entityId: primaryEnvVarId,
      predicateId: envVarSecretPredicateId,
      plaintext: "sk-live-first",
    });
    await authority.writeSecretField({
      entityId: secondaryEnvVarId,
      predicateId: envVarSecretPredicateId,
      plaintext: "xapp-secret",
    });

    const primarySecretId = authority.graph.envVar.get(primaryEnvVarId).secret;
    const secondarySecretId = authority.graph.envVar.get(secondaryEnvVarId).secret;
    if (!primarySecretId || !secondarySecretId) {
      throw new Error("Expected both env vars to reference secrets.");
    }

    const mutationStore = createStore();
    bootstrap(mutationStore, core);
    bootstrap(mutationStore, pkm);
    bootstrap(mutationStore, ops);
    const mutationGraph = createTypeClient(mutationStore, productGraph);
    mutationStore.replace(authority.store.snapshot());
    const before = mutationStore.snapshot();

    mutationGraph.envVar.update(primaryEnvVarId, {
      secret: secondarySecretId,
    });

    const transaction = buildGraphWriteTransaction(
      before,
      mutationStore.snapshot(),
      "tx:direct-secret",
    );

    await expect(authority.applyTransaction(transaction)).rejects.toThrow(
      'Field "ops:envVar:secret" requires "server-command" writes and cannot be changed through an ordinary transaction.',
    );
    expect(authority.graph.envVar.get(primaryEnvVarId).secret).toBe(primarySecretId);
  });

  it("routes generic secret-field writes through the web server helper", async () => {
    const storage = createInMemoryTestWebAppAuthorityStorage();
    const authority = await createWebAppAuthority(storage.storage);
    const envVarId = authority.graph.envVar.create({
      description: "Notifications integration",
      name: "SLACK_BOT_TOKEN",
    });

    const response = await handleSecretFieldRequest(
      new Request("http://web.local/api/secret-fields", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          entityId: envVarId,
          predicateId: envVarSecretPredicateId,
          plaintext: "xapp-secret",
        }),
      }),
      authority,
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
    expect(authority.graph.envVar.get(envVarId).secret).toBe(payload.secretId);
    expect(JSON.stringify(authority.createSyncPayload())).not.toContain("xapp-secret");
  });
});
