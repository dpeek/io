import { type AuthoritativeGraphRetainedHistoryPolicy } from "@io/graph-kernel";

import type { WebAppAuthority, WebAppAuthorityOptions } from "./authority.js";
import { createWebAppAuthority } from "./authority.js";
import {
  handleWebGraphAuthorityInternalRequest,
  isWebGraphAuthorityInternalPath,
  webGraphAuthorityBearerShareLookupPath,
  webGraphAuthorityPolicyVersionPath,
  webGraphAuthoritySessionPrincipalActivatePath,
  webGraphAuthoritySessionPrincipalLookupPath,
} from "./graph-authority-internal-routes.js";
import {
  bootstrapDurableObjectAuthoritySchema,
  createSqliteDurableObjectAuthorityStorage,
  readRetainedHistoryPolicy,
  type DurableObjectEnvLike,
  type DurableObjectStateLike as SqlDurableObjectStateLike,
} from "./graph-authority-sql-storage.js";
import { webSerializedQueryPath } from "./query-transport.js";
import {
  handleSerializedQueryRequest,
  handleWorkflowLiveRequest,
  handleWorkflowReadRequest,
  handleWebCommandRequest,
  RequestAuthorizationContextError,
  handleSyncRequest,
  handleTransactionRequest,
  readRequestAuthorizationContext,
} from "./server-routes.js";
import { createWorkflowReviewLiveScopeRouter } from "./workflow-live-scope-router.js";
import { webWorkflowLivePath } from "./workflow-live-transport.js";
import { webWorkflowReadPath } from "./workflow-transport.js";

type DurableObjectStateLike = SqlDurableObjectStateLike & {
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
};
export {
  webGraphAuthorityBearerShareLookupPath,
  webGraphAuthorityPolicyVersionPath,
  webGraphAuthoritySessionPrincipalActivatePath,
  webGraphAuthoritySessionPrincipalLookupPath,
};

type WebGraphAuthorityFactory = (
  storage: ReturnType<typeof createSqliteDurableObjectAuthorityStorage>,
  options: WebAppAuthorityOptions,
) => Promise<WebAppAuthority>;

export class WebGraphAuthorityDurableObject {
  private readonly state: DurableObjectStateLike;
  private readonly retainedHistoryPolicy: AuthoritativeGraphRetainedHistoryPolicy;
  private readonly createAuthority: WebGraphAuthorityFactory;
  private readonly workflowReviewLiveScopeRouter = createWorkflowReviewLiveScopeRouter();
  private authorityPromise: Promise<WebAppAuthority> | null = null;

  constructor(
    state: DurableObjectStateLike,
    env: DurableObjectEnvLike = {},
    options: {
      createAuthority?: WebGraphAuthorityFactory;
    } = {},
  ) {
    this.state = state;
    this.retainedHistoryPolicy = readRetainedHistoryPolicy(env);
    this.createAuthority = options.createAuthority ?? createWebAppAuthority;
    bootstrapDurableObjectAuthoritySchema(this.state.storage);
  }

  private getAuthority(): Promise<WebAppAuthority> {
    if (this.authorityPromise) return this.authorityPromise;

    const pending = this.state
      .blockConcurrencyWhile(() =>
        this.createAuthority(createSqliteDurableObjectAuthorityStorage(this.state), {
          retainedHistoryPolicy: this.retainedHistoryPolicy,
          onWorkflowReviewInvalidation: (invalidation) => {
            this.workflowReviewLiveScopeRouter.publish(invalidation);
          },
        }),
      )
      .catch((error) => {
        this.authorityPromise = null;
        throw error;
      });

    this.authorityPromise = pending;
    return pending;
  }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (isWebGraphAuthorityInternalPath(url.pathname)) {
      return this.state.blockConcurrencyWhile(() =>
        handleWebGraphAuthorityInternalRequest(request, url.pathname, this.getAuthority()),
      );
    }

    if (
      url.pathname !== "/api/sync" &&
      url.pathname !== "/api/tx" &&
      url.pathname !== "/api/commands" &&
      url.pathname !== webSerializedQueryPath &&
      url.pathname !== webWorkflowLivePath &&
      url.pathname !== webWorkflowReadPath
    ) {
      return new Response("Not Found", { status: 404 });
    }

    let authorization;
    try {
      authorization = readRequestAuthorizationContext(request);
    } catch (error) {
      if (error instanceof RequestAuthorizationContextError) {
        return Response.json(
          { error: error.message },
          {
            status: error.status,
            headers: {
              "cache-control": "no-store",
            },
          },
        );
      }
      throw error;
    }

    const authority = await this.getAuthority();

    if (url.pathname === "/api/sync") {
      return handleSyncRequest(request, authority, authorization);
    }

    if (url.pathname === "/api/tx") {
      return handleTransactionRequest(request, authority, authorization);
    }

    if (url.pathname === "/api/commands") {
      return handleWebCommandRequest(request, authority, authorization);
    }

    if (url.pathname === webSerializedQueryPath) {
      return handleSerializedQueryRequest(request, authority, authorization);
    }

    if (url.pathname === webWorkflowLivePath) {
      return handleWorkflowLiveRequest(
        request,
        authority,
        this.workflowReviewLiveScopeRouter,
        authorization,
      );
    }

    if (url.pathname === webWorkflowReadPath) {
      return handleWorkflowReadRequest(request, authority, authorization);
    }

    return new Response("Not Found", { status: 404 });
  }
}
