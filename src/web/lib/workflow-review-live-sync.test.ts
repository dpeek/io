import { describe, expect, it, setDefaultTimeout } from "bun:test";

import type { AuthorizationContext, GraphWriteTransaction } from "@io/core/graph";
import { createHttpGraphClient, type FetchImpl } from "@io/core/graph";
import { ops } from "@io/core/graph/modules/ops";
import { workflowReviewSyncScopeRequest } from "@io/core/graph/modules/ops/workflow";
import { pkm } from "@io/core/graph/modules/pkm";

import {
  createTestWebAppAuthority,
  createTestWorkflowFixture,
  executeTestWorkflowMutation,
} from "./authority-test-helpers.js";
import { type WebAppAuthority } from "./authority.js";
import { handleSyncRequest, handleWorkflowLiveRequest } from "./server-routes.js";
import { createWorkflowReviewLiveScopeRouter } from "./workflow-live-scope-router.js";
import { webWorkflowLivePath, type WorkflowLiveRequest } from "./workflow-live-transport.js";
import { createWorkflowReviewLiveSync } from "./workflow-review-live-sync.js";

const baseUrl = "https://web.local/";
const graphSchema = { ...pkm, ...ops } as const;
const principalId = "principal:test";
const sessionId = "session:test";
const authorization: AuthorizationContext = {
  graphId: "graph:test",
  principalId,
  principalKind: "human",
  sessionId,
  roleKeys: ["graph:authority"],
  capabilityGrantIds: [],
  capabilityVersion: 0,
  policyVersion: 0,
};

setDefaultTimeout(20_000);

function expectScopedCursor(cursor: string | undefined, rawCursor: string | undefined): void {
  expect(cursor).toContain(`cursor=${encodeURIComponent(rawCursor ?? "")}`);
}

type WorkflowLiveHarness = {
  readonly fetch: FetchImpl;
  readonly liveRequests: WorkflowLiveRequest[];
  readonly syncRequests: string[];
};

function createWorkflowLiveHarness(
  authority: WebAppAuthority,
  router: {
    current: ReturnType<typeof createWorkflowReviewLiveScopeRouter>;
  },
): WorkflowLiveHarness {
  const liveRequests: WorkflowLiveRequest[] = [];
  const syncRequests: string[] = [];

  return {
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);

      if (url.pathname === "/api/sync") {
        syncRequests.push(url.toString());
        return handleSyncRequest(request, authority, authorization);
      }

      if (url.pathname === webWorkflowLivePath) {
        liveRequests.push((await request.clone().json()) as WorkflowLiveRequest);
        return handleWorkflowLiveRequest(request, authority, router.current, authorization);
      }

      if (url.pathname === "/api/tx" && request.method === "POST") {
        const transaction = (await request.json()) as GraphWriteTransaction;
        return Response.json(
          await authority.applyTransaction(transaction, {
            authorization,
          }),
        );
      }

      return Response.json(
        { error: `Unhandled ${request.method} ${url.pathname}` },
        { status: 404 },
      );
    },
    liveRequests,
    syncRequests,
  };
}

describe("workflow review live sync", () => {
  it("scoped re-pulls the workflow review scope after a cursor-advanced invalidation", async () => {
    const router = {
      current: createWorkflowReviewLiveScopeRouter(),
    };
    const authority = await createTestWebAppAuthority(undefined, {
      onWorkflowReviewInvalidation(invalidation) {
        router.current.publish(invalidation);
      },
    });
    const fixture = await createTestWorkflowFixture(authority, authorization);
    const harness = createWorkflowLiveHarness(authority, router);
    const client = await createHttpGraphClient(graphSchema, {
      fetch: harness.fetch,
      requestedScope: workflowReviewSyncScopeRequest,
      url: baseUrl,
    });
    const liveSync = createWorkflowReviewLiveSync(client.sync, {
      fetch: harness.fetch,
      url: baseUrl,
    });
    const initialCursor = client.sync.getState().cursor;

    await liveSync.register();
    const created = await executeTestWorkflowMutation(authority, authorization, {
      action: "createCommit",
      branchId: fixture.branchId,
      title: "Workflow live scoped refresh",
      commitKey: "commit:workflow-live-scoped-refresh",
      order: 0,
      state: "ready",
    });
    const polled = await liveSync.poll();

    if (!initialCursor) {
      throw new Error("Expected the workflow review bootstrap cursor.");
    }
    expect(polled.action).toBe("scoped-refresh");
    expect(polled.live.active).toBe(true);
    expect(polled.invalidations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceCursor: created.cursor,
          delivery: { kind: "cursor-advanced" },
        }),
      ]),
    );
    expect(polled.syncResult).toMatchObject({
      mode: "incremental",
      after: initialCursor,
      scope: {
        kind: "module",
        moduleId: workflowReviewSyncScopeRequest.moduleId,
        scopeId: workflowReviewSyncScopeRequest.scopeId,
      },
    });
    expect(client.sync.getState()).toMatchObject({
      requestedScope: workflowReviewSyncScopeRequest,
      scope: {
        kind: "module",
        moduleId: workflowReviewSyncScopeRequest.moduleId,
        scopeId: workflowReviewSyncScopeRequest.scopeId,
      },
      status: "ready",
    });
    expectScopedCursor(client.sync.getState().cursor, created.cursor);
    expect(client.graph.workflowCommit.get(created.summary.id).name).toBe(
      "Workflow live scoped refresh",
    );
    expect(harness.liveRequests.map((request) => request.kind)).toEqual([
      "workflow-review-register",
      "workflow-review-pull",
    ]);
    expect(harness.syncRequests).toEqual([
      "https://web.local/api/sync?scopeKind=module&moduleId=ops%2Fworkflow&scopeId=scope%3Aops%2Fworkflow%3Areview",
      `https://web.local/api/sync?after=${encodeURIComponent(initialCursor)}&scopeKind=module&moduleId=ops%2Fworkflow&scopeId=scope%3Aops%2Fworkflow%3Areview`,
    ]);
  });

  it("re-registers and scoped re-pulls after workflow live registration expiry", async () => {
    let now = new Date("2026-03-24T00:00:00.000Z");
    const router = {
      current: createWorkflowReviewLiveScopeRouter({
        now: () => now,
        registrationTtlMs: 1_000,
      }),
    };
    const authority = await createTestWebAppAuthority(undefined, {
      onWorkflowReviewInvalidation(invalidation) {
        router.current.publish(invalidation);
      },
    });
    const fixture = await createTestWorkflowFixture(authority, authorization);
    const harness = createWorkflowLiveHarness(authority, router);
    const client = await createHttpGraphClient(graphSchema, {
      fetch: harness.fetch,
      requestedScope: workflowReviewSyncScopeRequest,
      url: baseUrl,
    });
    const liveSync = createWorkflowReviewLiveSync(client.sync, {
      fetch: harness.fetch,
      url: baseUrl,
    });
    const initialCursor = client.sync.getState().cursor;

    await liveSync.register();
    now = new Date("2026-03-24T00:00:01.001Z");
    const created = await executeTestWorkflowMutation(authority, authorization, {
      action: "createCommit",
      branchId: fixture.branchId,
      title: "Workflow live expiry recovery",
      commitKey: "commit:workflow-live-expiry-recovery",
      order: 0,
      state: "ready",
    });
    const polled = await liveSync.poll();

    if (!initialCursor) {
      throw new Error("Expected the workflow review bootstrap cursor.");
    }
    expect(polled.action).toBe("reregister-and-scoped-refresh");
    expect(polled.live).toEqual({
      active: false,
      invalidations: [],
      scopeId: workflowReviewSyncScopeRequest.scopeId,
      sessionId,
    });
    expect(polled.registration).toMatchObject({
      scopeId: workflowReviewSyncScopeRequest.scopeId,
      sessionId,
    });
    expect(polled.syncResult).toMatchObject({
      mode: "incremental",
      after: initialCursor,
      scope: {
        kind: "module",
        moduleId: workflowReviewSyncScopeRequest.moduleId,
        scopeId: workflowReviewSyncScopeRequest.scopeId,
      },
    });
    expectScopedCursor(polled.syncResult?.cursor, created.cursor);
    expect(client.sync.getState()).toMatchObject({
      requestedScope: workflowReviewSyncScopeRequest,
      status: "ready",
    });
    expectScopedCursor(client.sync.getState().cursor, created.cursor);
    expect(client.graph.workflowCommit.get(created.summary.id).name).toBe(
      "Workflow live expiry recovery",
    );
    expect(harness.liveRequests.map((request) => request.kind)).toEqual([
      "workflow-review-register",
      "workflow-review-pull",
      "workflow-review-register",
    ]);
    expect(harness.syncRequests).toEqual([
      "https://web.local/api/sync?scopeKind=module&moduleId=ops%2Fworkflow&scopeId=scope%3Aops%2Fworkflow%3Areview",
      `https://web.local/api/sync?after=${encodeURIComponent(initialCursor)}&scopeKind=module&moduleId=ops%2Fworkflow&scopeId=scope%3Aops%2Fworkflow%3Areview`,
    ]);
  });

  it("re-registers and scoped re-pulls after router loss", async () => {
    const router = {
      current: createWorkflowReviewLiveScopeRouter(),
    };
    const authority = await createTestWebAppAuthority(undefined, {
      onWorkflowReviewInvalidation(invalidation) {
        router.current.publish(invalidation);
      },
    });
    const fixture = await createTestWorkflowFixture(authority, authorization);
    const harness = createWorkflowLiveHarness(authority, router);
    const client = await createHttpGraphClient(graphSchema, {
      fetch: harness.fetch,
      requestedScope: workflowReviewSyncScopeRequest,
      url: baseUrl,
    });
    const liveSync = createWorkflowReviewLiveSync(client.sync, {
      fetch: harness.fetch,
      url: baseUrl,
    });
    const initialCursor = client.sync.getState().cursor;

    await liveSync.register();
    router.current = createWorkflowReviewLiveScopeRouter();
    const created = await executeTestWorkflowMutation(authority, authorization, {
      action: "createCommit",
      branchId: fixture.branchId,
      title: "Workflow live router-loss recovery",
      commitKey: "commit:workflow-live-router-loss-recovery",
      order: 0,
      state: "ready",
    });
    const polled = await liveSync.poll();

    if (!initialCursor) {
      throw new Error("Expected the workflow review bootstrap cursor.");
    }
    expect(polled.action).toBe("reregister-and-scoped-refresh");
    expect(polled.live).toEqual({
      active: false,
      invalidations: [],
      scopeId: workflowReviewSyncScopeRequest.scopeId,
      sessionId,
    });
    expect(polled.registration).toMatchObject({
      scopeId: workflowReviewSyncScopeRequest.scopeId,
      sessionId,
    });
    expect(polled.syncResult).toMatchObject({
      mode: "incremental",
      after: initialCursor,
      scope: {
        kind: "module",
        moduleId: workflowReviewSyncScopeRequest.moduleId,
        scopeId: workflowReviewSyncScopeRequest.scopeId,
      },
    });
    expectScopedCursor(polled.syncResult?.cursor, created.cursor);
    expect(client.graph.workflowCommit.get(created.summary.id).name).toBe(
      "Workflow live router-loss recovery",
    );
    expect(harness.liveRequests.map((request) => request.kind)).toEqual([
      "workflow-review-register",
      "workflow-review-pull",
      "workflow-review-register",
    ]);
    expect(harness.syncRequests).toEqual([
      "https://web.local/api/sync?scopeKind=module&moduleId=ops%2Fworkflow&scopeId=scope%3Aops%2Fworkflow%3Areview",
      `https://web.local/api/sync?after=${encodeURIComponent(initialCursor)}&scopeKind=module&moduleId=ops%2Fworkflow&scopeId=scope%3Aops%2Fworkflow%3Areview`,
    ]);
  });
});
