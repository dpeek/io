import type { PublicSiteGraphBaseline } from "@dpeek/graphle-module-site";
import {
  createGraphlePublicSiteRuntimeFromBaseline,
  listGraphleSiteItemViews,
} from "@dpeek/graphle-site-web/public-runtime";

import { CloudflareDeployError, redactCloudflareDeploySecrets } from "./contracts.js";
import { graphlePublicSiteBaselinePath, graphlePublicSiteHealthPath } from "./worker.js";

export class CloudflarePublicSitePublishError extends CloudflareDeployError {
  constructor(
    message: string,
    code: string,
    options: {
      readonly status?: number;
      readonly retryable?: boolean;
      readonly cause?: unknown;
    } = {},
  ) {
    super(message, code, options);
    this.name = "CloudflarePublicSitePublishError";
  }
}

export const defaultCloudflarePublishRetryDelaysMs = [
  1000, 2000, 4000, 8000, 16000, 30000, 45000,
] as const;

export interface PublishPublicSiteBaselineOptions {
  readonly workerUrl: string | URL;
  readonly baseline: PublicSiteGraphBaseline;
  readonly deploySecret: string;
  readonly fetch?: typeof fetch;
  readonly purgePaths?: (paths: readonly string[]) => Promise<void> | void;
  readonly retryDelaysMs?: readonly number[];
  readonly sleep?: (delayMs: number) => Promise<void> | void;
}

export interface PublishPublicSiteBaselineResult {
  readonly baselineHash: string;
  readonly paths: readonly string[];
  readonly healthStatus: number;
  readonly homeStatus: number;
}

function workerEndpoint(workerUrl: string | URL, pathname: string): URL {
  const endpoint = new URL(workerUrl);
  endpoint.pathname = pathname;
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint;
}

function isRetryablePublishStatus(status: number): boolean {
  return (
    status === 401 ||
    status === 404 ||
    status === 405 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function summarizeFailureResponse(
  response: Response,
  secrets: readonly string[],
): Promise<string> {
  const text = await response
    .clone()
    .text()
    .catch(() => "");
  const body = redactCloudflareDeploySecrets(text.replaceAll(/\s+/g, " ").trim(), secrets);
  if (!body) return "";
  return body.length > 500 ? `${body.slice(0, 500)}...` : body;
}

async function throwPublishResponseError({
  attemptCount,
  code,
  message,
  response,
  secrets,
}: {
  readonly attemptCount: number;
  readonly code: string;
  readonly message: string;
  readonly response: Response;
  readonly secrets: readonly string[];
}): Promise<never> {
  const summary = await summarizeFailureResponse(response, secrets);
  const retryable = isRetryablePublishStatus(response.status);
  const statusText = response.statusText ? ` ${response.statusText}` : "";
  const attempts = attemptCount > 1 ? ` after ${attemptCount} attempts` : "";
  const suffix = summary ? `: ${summary}` : ".";
  throw new CloudflarePublicSitePublishError(
    `${message} Cloudflare returned HTTP ${response.status}${statusText}${attempts}${suffix}`,
    code,
    {
      status: response.status,
      retryable,
    },
  );
}

async function fetchPublishStep({
  code,
  message,
  request,
  retryStatus,
  retryDelaysMs,
  secrets,
  sleep,
}: {
  readonly code: string;
  readonly message: string;
  readonly request: () => Promise<Response>;
  readonly retryStatus?: (status: number) => boolean;
  readonly retryDelaysMs: readonly number[];
  readonly secrets: readonly string[];
  readonly sleep: (delayMs: number) => Promise<void> | void;
}): Promise<Response> {
  let attempt = 0;

  for (;;) {
    let response: Response;
    try {
      response = await request();
    } catch (error) {
      const retryable = attempt < retryDelaysMs.length;
      if (!retryable) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new CloudflarePublicSitePublishError(`${message} ${detail}`, code, {
          retryable: true,
          cause: error,
        });
      }
      await sleep(retryDelaysMs[attempt] ?? 0);
      attempt += 1;
      continue;
    }

    if (response.ok) return response;

    const retryable =
      (retryStatus?.(response.status) ?? isRetryablePublishStatus(response.status)) &&
      attempt < retryDelaysMs.length;
    if (!retryable) {
      await throwPublishResponseError({
        attemptCount: attempt + 1,
        code,
        message,
        response,
        secrets,
      });
    }

    await sleep(retryDelaysMs[attempt] ?? 0);
    attempt += 1;
  }
}

export function listPublicSiteBaselineCachePaths(
  baseline: PublicSiteGraphBaseline,
): readonly string[] {
  const runtime = createGraphlePublicSiteRuntimeFromBaseline(baseline);
  const paths = new Set<string>(["/"]);

  for (const item of listGraphleSiteItemViews(runtime)) {
    if (item.path) paths.add(item.path);
  }

  return [...paths].sort((left, right) => {
    if (left === "/") return -1;
    if (right === "/") return 1;
    return left.localeCompare(right);
  });
}

export async function publishPublicSiteBaseline({
  workerUrl,
  baseline,
  deploySecret,
  fetch: fetcher = fetch,
  purgePaths,
  retryDelaysMs = defaultCloudflarePublishRetryDelaysMs,
  sleep = defaultSleep,
}: PublishPublicSiteBaselineOptions): Promise<PublishPublicSiteBaselineResult> {
  const paths = listPublicSiteBaselineCachePaths(baseline);
  await fetchPublishStep({
    code: "baseline.replace_failed",
    message: "Cloudflare public baseline replacement failed.",
    retryStatus: (status) => status === 400 || isRetryablePublishStatus(status),
    retryDelaysMs,
    secrets: [deploySecret],
    sleep,
    request: () =>
      fetcher(workerEndpoint(workerUrl, graphlePublicSiteBaselinePath), {
        method: "PUT",
        headers: {
          authorization: `Bearer ${deploySecret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(baseline),
      }),
  });

  await purgePaths?.(paths);

  const health = await fetchPublishStep({
    code: "health.failed",
    message: "Cloudflare public site health verification failed.",
    retryDelaysMs,
    secrets: [deploySecret],
    sleep,
    request: () => fetcher(workerEndpoint(workerUrl, graphlePublicSiteHealthPath)),
  });

  const home = await fetchPublishStep({
    code: "home.failed",
    message: "Cloudflare public home route verification failed.",
    retryDelaysMs,
    secrets: [deploySecret],
    sleep,
    request: () =>
      fetcher(workerEndpoint(workerUrl, "/"), {
        headers: {
          "cache-control": "no-cache",
        },
      }),
  });

  return {
    baselineHash: baseline.baselineHash,
    paths,
    healthStatus: health.status,
    homeStatus: home.status,
  };
}
