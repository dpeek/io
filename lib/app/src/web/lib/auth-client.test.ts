import { describe, expect, it } from "bun:test";

import type { WebPrincipalBootstrapPayload } from "@io/graph-authority";

import {
  completeLocalhostOnboarding,
  resolveWebPrincipalBootstrap,
  fetchWebPrincipalBootstrap,
  issueLocalhostBootstrapCredential,
  readWebAuthState,
  readWebPrincipalDisplayName,
  redeemLocalhostBootstrapCredential,
  startLocalhostBootstrapSession,
  webGraphAccessActivationPath,
  webGraphCommandsPath,
  webPrincipalBootstrapPath,
} from "./auth-client.js";
import {
  localhostBootstrapIssuePath,
  localhostBootstrapRedeemPath,
  type LocalhostBootstrapCredential,
} from "./local-bootstrap.js";

function createBootstrapPayload(
  overrides: Partial<WebPrincipalBootstrapPayload> = {},
): WebPrincipalBootstrapPayload {
  return {
    session: {
      authState: "ready",
      sessionId: "session-1",
      principalId: "principal-1",
      capabilityVersion: 4,
      displayName: "Operator",
    },
    principal: {
      graphId: "graph-1",
      principalId: "principal-1",
      principalKind: "human",
      roleKeys: ["graph:member"],
      capabilityGrantIds: ["grant-1"],
      access: {
        authority: false,
        graphMember: true,
        sharedRead: false,
      },
      capabilityVersion: 4,
      policyVersion: 7,
    },
    ...overrides,
  };
}

function createLocalhostCredential(): LocalhostBootstrapCredential {
  return {
    kind: "localhost-bootstrap",
    availability: "localhost-only",
    token: "io_local_bootstrap_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    issuedAt: "2026-03-30T00:00:00.000Z",
    expiresAt: "2026-03-30T00:05:00.000Z",
    redeemOrigin: "http://io.localhost:8787",
    oneTimeUse: true,
    syntheticIdentity: {
      localIdentityId: "local:default",
      email: "local+default@localhost.invalid",
      displayName: "Local Operator",
    },
  };
}

function createSyntheticReadyBootstrapPayload(
  overrides: Partial<WebPrincipalBootstrapPayload> = {},
): WebPrincipalBootstrapPayload {
  const email = createLocalhostCredential().syntheticIdentity.email;
  return createBootstrapPayload({
    session: {
      authState: "ready",
      sessionId: "session-local",
      principalId: "principal-local",
      capabilityVersion: 0,
      displayName: email,
    },
    principal: {
      graphId: "graph:global",
      principalId: "principal-local",
      principalKind: "human",
      roleKeys: [],
      capabilityGrantIds: [],
      access: {
        authority: false,
        graphMember: false,
        sharedRead: false,
      },
      capabilityVersion: 0,
      policyVersion: 0,
    },
    ...overrides,
  });
}

describe("web auth client helpers", () => {
  it("treats a pending empty session query as booting", () => {
    expect(
      readWebAuthState({
        data: null,
        error: null,
        isPending: true,
        isRefetching: false,
      }),
    ).toEqual({
      status: "booting",
      authState: "booting",
      bootstrap: null,
      principal: null,
      sessionId: null,
      principalId: null,
      capabilityVersion: null,
      displayName: null,
      errorMessage: null,
      isRefetching: false,
    });
  });

  it("treats a settled empty session query as signed out", () => {
    expect(
      readWebAuthState({
        data: null,
        error: null,
        isPending: false,
        isRefetching: false,
      }),
    ).toEqual({
      status: "signed-out",
      authState: "signed-out",
      bootstrap: expect.objectContaining({
        session: expect.objectContaining({
          authState: "signed-out",
        }),
      }),
      principal: null,
      sessionId: null,
      principalId: null,
      capabilityVersion: null,
      displayName: null,
      errorMessage: null,
      isRefetching: false,
    });
  });

  it("projects the resolved principal bootstrap into the signed-in shell view", () => {
    const payload = createBootstrapPayload();

    expect(
      readWebAuthState({
        data: payload,
        error: null,
        isPending: false,
        isRefetching: true,
      }),
    ).toEqual({
      status: "ready",
      authState: "ready",
      bootstrap: payload,
      principal: payload.principal!,
      sessionId: "session-1",
      principalId: "principal-1",
      capabilityVersion: 4,
      displayName: "Operator",
      errorMessage: null,
      isRefetching: true,
    });
  });

  it("keeps the last signed-in bootstrap visible while a retry is in flight", () => {
    const payload = createBootstrapPayload();

    expect(
      readWebAuthState({
        data: payload,
        error: null,
        isPending: false,
        isRefetching: true,
      }),
    ).toEqual({
      status: "ready",
      authState: "ready",
      bootstrap: payload,
      principal: payload.principal!,
      sessionId: "session-1",
      principalId: "principal-1",
      capabilityVersion: 4,
      displayName: "Operator",
      errorMessage: null,
      isRefetching: true,
    });
  });

  it("preserves explicit expired bootstrap state for reauthentication flows", () => {
    const payload = createBootstrapPayload({
      session: {
        authState: "expired",
        sessionId: null,
        principalId: null,
        capabilityVersion: null,
      },
      principal: null,
    });

    expect(
      readWebAuthState({
        data: payload,
        error: null,
        isPending: false,
        isRefetching: false,
      }),
    ).toEqual({
      status: "expired",
      authState: "expired",
      bootstrap: payload,
      principal: null,
      sessionId: null,
      principalId: null,
      capabilityVersion: null,
      displayName: null,
      errorMessage: null,
      isRefetching: false,
    });
  });

  it("reads display labels from the shared bootstrap contract without inventing new fields", () => {
    expect(readWebPrincipalDisplayName(createBootstrapPayload())).toBe("Operator");
    expect(
      readWebPrincipalDisplayName(
        createBootstrapPayload({
          session: {
            authState: "ready",
            sessionId: "session-1",
            principalId: "principal-1",
            capabilityVersion: 4,
            displayName: "   ",
          },
        }),
      ),
    ).toBeNull();
  });

  it("surfaces failed bootstrap reads without pretending the shell is ready", () => {
    expect(
      readWebAuthState({
        data: null,
        error: {
          message: "AUTH_DB unavailable",
        },
        isPending: false,
        isRefetching: false,
      }),
    ).toEqual({
      status: "error",
      authState: "booting",
      bootstrap: null,
      principal: null,
      sessionId: null,
      principalId: null,
      capabilityVersion: null,
      displayName: null,
      errorMessage: "AUTH_DB unavailable",
      isRefetching: false,
    });
  });

  it("keeps bootstrap failures in an explicit error state during retry", () => {
    expect(
      readWebAuthState({
        data: null,
        error: {
          message: "principal lookup unavailable",
        },
        isPending: false,
        isRefetching: true,
      }),
    ).toEqual({
      status: "error",
      authState: "booting",
      bootstrap: null,
      principal: null,
      sessionId: null,
      principalId: null,
      capabilityVersion: null,
      displayName: null,
      errorMessage: "principal lookup unavailable",
      isRefetching: true,
    });
  });

  it("fetches and validates the shared principal bootstrap payload", async () => {
    const payload = createBootstrapPayload();

    await expect(
      fetchWebPrincipalBootstrap({
        fetcher: async () =>
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          }),
      }),
    ).resolves.toEqual(payload);
  });

  it("surfaces worker-provided bootstrap error messages for retry UI", async () => {
    await expect(
      fetchWebPrincipalBootstrap({
        fetcher: async () =>
          new Response(
            JSON.stringify({
              error: "Better Auth session verification is unavailable.",
            }),
            {
              status: 503,
              statusText: "Service Unavailable",
              headers: {
                "content-type": "application/json",
              },
            },
          ),
      }),
    ).rejects.toThrow("Better Auth session verification is unavailable.");
  });

  it("falls back to an HTTP summary when bootstrap failures do not return JSON", async () => {
    await expect(
      fetchWebPrincipalBootstrap({
        fetcher: async () =>
          new Response("down", {
            status: 503,
            statusText: "Service Unavailable",
          }),
      }),
    ).rejects.toThrow("Unable to load the principal bootstrap (503 Service Unavailable).");
  });

  it("issues and validates the localhost bootstrap credential contract", async () => {
    const credential = createLocalhostCredential();

    await expect(
      issueLocalhostBootstrapCredential({
        fetcher: async (path, init) => {
          expect(path).toBe(localhostBootstrapIssuePath);
          expect(init).toMatchObject({
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
          });
          return new Response(JSON.stringify(credential), {
            status: 201,
            headers: {
              "content-type": "application/json",
            },
          });
        },
      }),
    ).resolves.toEqual(credential);
  });

  it("surfaces localhost bootstrap issuance failures", async () => {
    await expect(
      issueLocalhostBootstrapCredential({
        fetcher: async () =>
          new Response(
            JSON.stringify({
              error: "Localhost bootstrap is unavailable for this origin.",
            }),
            {
              status: 404,
              statusText: "Not Found",
              headers: {
                "content-type": "application/json",
              },
            },
          ),
      }),
    ).rejects.toThrow("Localhost bootstrap is unavailable for this origin.");
  });

  it("redeems localhost bootstrap credentials through the dedicated worker path", async () => {
    const requests: Array<{
      readonly input: string;
      readonly init: RequestInit | undefined;
    }> = [];

    await redeemLocalhostBootstrapCredential({
      token: createLocalhostCredential().token,
      fetcher: async (input, init) => {
        requests.push({ input, init });
        return new Response(null, {
          status: 204,
        });
      },
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.input).toBe(localhostBootstrapRedeemPath);
    expect(requests[0]?.init).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({
        token: createLocalhostCredential().token,
      }),
    });
    expect(new Headers(requests[0]?.init?.headers).get("content-type")).toBe("application/json");
  });

  it("chains localhost bootstrap issue and redeem into one browser-session helper", async () => {
    const credential = createLocalhostCredential();
    const calls: string[] = [];

    await expect(
      startLocalhostBootstrapSession({
        fetcher: async (path, init) => {
          calls.push(path);
          if (path === localhostBootstrapIssuePath) {
            expect(init?.method).toBe("POST");
            return new Response(JSON.stringify(credential), {
              status: 201,
              headers: {
                "content-type": "application/json",
              },
            });
          }

          if (path === localhostBootstrapRedeemPath) {
            expect(init).toMatchObject({
              method: "POST",
              body: JSON.stringify({
                token: credential.token,
              }),
            });
            return new Response(null, {
              status: 204,
            });
          }

          throw new Error(`Unexpected fetch path ${path}`);
        },
      }),
    ).resolves.toEqual(credential);

    expect(calls).toEqual([localhostBootstrapIssuePath, localhostBootstrapRedeemPath]);
  });

  it("keeps bootstrap reads passive until the signed-out shell starts localhost onboarding", async () => {
    const signedOutPayload = {
      session: {
        authState: "signed-out",
        sessionId: null,
        principalId: null,
        capabilityVersion: null,
      },
      principal: null,
    } as const;
    const calls: string[] = [];

    await expect(
      resolveWebPrincipalBootstrap({
        fetcher: async (path, init) => {
          calls.push(path);
          expect(init).toMatchObject({
            method: "GET",
            credentials: "same-origin",
            cache: "no-store",
          });
          return new Response(JSON.stringify(signedOutPayload), {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          });
        },
      }),
    ).resolves.toEqual(signedOutPayload);

    expect(calls).toEqual([webPrincipalBootstrapPath]);
  });

  it("activates the localhost first-user path after the local session is established", async () => {
    const credential = createLocalhostCredential();
    const finalPayload = createSyntheticReadyBootstrapPayload({
      session: {
        authState: "ready",
        sessionId: "session-local",
        principalId: "principal-local",
        capabilityVersion: 1,
        displayName: credential.syntheticIdentity.email,
      },
      principal: {
        graphId: "graph:global",
        principalId: "principal-local",
        principalKind: "human",
        roleKeys: ["graph:authority", "graph:owner"],
        capabilityGrantIds: [],
        access: {
          authority: true,
          graphMember: true,
          sharedRead: false,
        },
        capabilityVersion: 1,
        policyVersion: 0,
      },
    });
    const calls: string[] = [];

    await expect(
      completeLocalhostOnboarding({
        fetcher: async (path, init) => {
          calls.push(path);
          if (path === localhostBootstrapIssuePath) {
            expect(init).toMatchObject({
              method: "POST",
              credentials: "same-origin",
              cache: "no-store",
            });
            return new Response(JSON.stringify(credential), {
              status: 201,
              headers: {
                "content-type": "application/json",
              },
            });
          }

          if (path === localhostBootstrapRedeemPath) {
            return new Response(null, { status: 204 });
          }

          if (path === webPrincipalBootstrapPath && calls.length === 3) {
            return new Response(JSON.stringify(createSyntheticReadyBootstrapPayload()), {
              status: 200,
              headers: {
                "content-type": "application/json",
              },
            });
          }

          if (path === webGraphAccessActivationPath) {
            return new Response(
              JSON.stringify({
                summary: finalPayload.principal,
                principalId: "principal-local",
                principalKind: "human",
                roleKeys: ["graph:authority", "graph:owner"],
                capabilityGrantIds: [],
                capabilityVersion: 1,
              }),
              {
                status: 200,
                headers: {
                  "content-type": "application/json",
                },
              },
            );
          }

          if (path === webPrincipalBootstrapPath && calls.length === 5) {
            return new Response(JSON.stringify(finalPayload), {
              status: 200,
              headers: {
                "content-type": "application/json",
              },
            });
          }

          throw new Error(`Unexpected fetch path ${path}`);
        },
        origin: credential.redeemOrigin,
      }),
    ).resolves.toEqual(finalPayload);

    expect(calls).toEqual([
      localhostBootstrapIssuePath,
      localhostBootstrapRedeemPath,
      webPrincipalBootstrapPath,
      webGraphAccessActivationPath,
      webPrincipalBootstrapPath,
    ]);
  });

  it("bootstraps the local operator when activation alone stays unwritable", async () => {
    const credential = createLocalhostCredential();
    const finalPayload = createSyntheticReadyBootstrapPayload({
      session: {
        authState: "ready",
        sessionId: "session-local",
        principalId: "principal-local",
        capabilityVersion: 1,
        displayName: credential.syntheticIdentity.email,
      },
      principal: {
        graphId: "graph:global",
        principalId: "principal-local",
        principalKind: "human",
        roleKeys: ["graph:authority", "graph:owner"],
        capabilityGrantIds: [],
        access: {
          authority: true,
          graphMember: true,
          sharedRead: false,
        },
        capabilityVersion: 1,
        policyVersion: 0,
      },
    });
    const calls: string[] = [];

    await expect(
      completeLocalhostOnboarding({
        fetcher: async (path, init) => {
          calls.push(path);
          if (path === localhostBootstrapIssuePath) {
            return new Response(JSON.stringify(credential), {
              status: 201,
              headers: {
                "content-type": "application/json",
              },
            });
          }

          if (path === localhostBootstrapRedeemPath) {
            return new Response(null, { status: 204 });
          }

          if (path === webPrincipalBootstrapPath && calls.length === 3) {
            return new Response(JSON.stringify(createSyntheticReadyBootstrapPayload()), {
              status: 200,
              headers: {
                "content-type": "application/json",
              },
            });
          }

          if (path === webGraphAccessActivationPath && calls.length === 4) {
            return new Response(
              JSON.stringify({
                summary: createSyntheticReadyBootstrapPayload().principal,
                principalId: "principal-local",
                principalKind: "human",
                roleKeys: [],
                capabilityGrantIds: [],
                capabilityVersion: 0,
              }),
              {
                status: 200,
                headers: {
                  "content-type": "application/json",
                },
              },
            );
          }

          if (path === webGraphCommandsPath) {
            expect(init).toMatchObject({
              method: "POST",
              credentials: "omit",
              cache: "no-store",
            });
            expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
            expect(init?.body).toBe(
              JSON.stringify({
                kind: "bootstrap-operator-access",
                input: {
                  email: credential.syntheticIdentity.email,
                  graphId: "graph:global",
                },
              }),
            );
            return new Response(
              JSON.stringify({
                created: true,
                email: credential.syntheticIdentity.email,
                graphId: "graph:global",
                roleKeys: ["graph:authority", "graph:owner"],
              }),
              {
                status: 201,
                headers: {
                  "content-type": "application/json",
                },
              },
            );
          }

          if (path === webGraphAccessActivationPath && calls.length === 6) {
            return new Response(
              JSON.stringify({
                summary: finalPayload.principal,
                principalId: "principal-local",
                principalKind: "human",
                roleKeys: ["graph:authority", "graph:owner"],
                capabilityGrantIds: [],
                capabilityVersion: 1,
              }),
              {
                status: 200,
                headers: {
                  "content-type": "application/json",
                },
              },
            );
          }

          if (path === webPrincipalBootstrapPath && calls.length === 7) {
            return new Response(JSON.stringify(finalPayload), {
              status: 200,
              headers: {
                "content-type": "application/json",
              },
            });
          }

          throw new Error(`Unexpected fetch path ${path}`);
        },
        origin: credential.redeemOrigin,
      }),
    ).resolves.toEqual(finalPayload);

    expect(calls).toEqual([
      localhostBootstrapIssuePath,
      localhostBootstrapRedeemPath,
      webPrincipalBootstrapPath,
      webGraphAccessActivationPath,
      webGraphCommandsPath,
      webGraphAccessActivationPath,
      webPrincipalBootstrapPath,
    ]);
  });

  it("fails clearly when localhost instant onboarding cannot choose a unique safe operator path", async () => {
    const credential = createLocalhostCredential();
    const calls: string[] = [];

    await expect(
      completeLocalhostOnboarding({
        fetcher: async (path) => {
          calls.push(path);

          if (path === localhostBootstrapIssuePath) {
            return new Response(JSON.stringify(credential), {
              status: 201,
              headers: {
                "content-type": "application/json",
              },
            });
          }

          if (path === localhostBootstrapRedeemPath) {
            return new Response(null, { status: 204 });
          }

          if (path === webPrincipalBootstrapPath && calls.length === 3) {
            return new Response(JSON.stringify(createSyntheticReadyBootstrapPayload()), {
              status: 200,
              headers: {
                "content-type": "application/json",
              },
            });
          }

          if (path === webGraphAccessActivationPath) {
            return new Response(
              JSON.stringify({
                summary: createSyntheticReadyBootstrapPayload().principal,
                principalId: "principal-local",
                principalKind: "human",
                roleKeys: [],
                capabilityGrantIds: [],
                capabilityVersion: 0,
              }),
              {
                status: 200,
                headers: {
                  "content-type": "application/json",
                },
              },
            );
          }

          if (path === webGraphCommandsPath) {
            return new Response(
              JSON.stringify({
                error:
                  'Bootstrap operator access is unavailable because graph "graph:global" already has an active operator.',
              }),
              {
                status: 409,
                headers: {
                  "content-type": "application/json",
                },
              },
            );
          }

          throw new Error(`Unexpected fetch path ${path}`);
        },
        origin: credential.redeemOrigin,
      }),
    ).rejects.toThrow('graph "graph:global" already has an active operator');

    expect(calls).toEqual([
      localhostBootstrapIssuePath,
      localhostBootstrapRedeemPath,
      webPrincipalBootstrapPath,
      webGraphAccessActivationPath,
      webGraphCommandsPath,
    ]);
  });

  it("rejects malformed authenticated bootstrap payloads instead of guessing session state", () => {
    expect(() =>
      readWebAuthState({
        data: createBootstrapPayload({
          session: {
            authState: "ready",
            sessionId: "session-1",
            principalId: "principal-1",
            capabilityVersion: 4,
            displayName: "Operator",
          },
          principal: null,
        }),
        error: null,
        isPending: false,
        isRefetching: false,
      }),
    ).toThrow(
      'Authenticated bootstrap payloads must include both "session.sessionId" and "principal".',
    );
  });
});
