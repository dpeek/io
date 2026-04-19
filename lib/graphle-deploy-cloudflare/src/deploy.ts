import type { PublicSiteGraphBaseline } from "@dpeek/graphle-module-site";
import {
  createGraphlePublicSiteRuntimeFromBaseline,
  listGraphleSiteItemViews,
} from "@dpeek/graphle-site-web/public-runtime";

import {
  CloudflareDeployError,
  generateCloudflareDeploySecret,
  validateCloudflareDeployInput,
  type CloudflareDeployInput,
  type CloudflareDeployResult,
} from "./contracts.js";
import {
  provisionCloudflarePublicSiteWorker,
  type CloudflareWorkerBundle,
} from "./cloudflare-api.js";
import { publishPublicSiteBaseline } from "./publish.js";

export interface DeployCloudflarePublicSiteOptions {
  readonly input: CloudflareDeployInput;
  readonly baseline: PublicSiteGraphBaseline;
  readonly siteWebAssetsPath?: string;
  readonly fetch?: typeof fetch;
  readonly apiBaseUrl?: string;
  readonly workerBundle?: CloudflareWorkerBundle;
  readonly now?: () => Date;
  readonly generateDeploySecret?: () => string;
}

function urlOnlyPublicItemNeedle(baseline: PublicSiteGraphBaseline): string | undefined {
  const runtime = createGraphlePublicSiteRuntimeFromBaseline(baseline);
  const item = listGraphleSiteItemViews(runtime).find(
    (candidate) => !candidate.path && candidate.url,
  );
  return item ? `${item.title}\n${item.url}` : undefined;
}

async function verifyUrlOnlyPublicItem({
  baseline,
  fetcher,
  workerUrl,
}: {
  readonly baseline: PublicSiteGraphBaseline;
  readonly fetcher: typeof fetch;
  readonly workerUrl: string;
}): Promise<void> {
  const needle = urlOnlyPublicItemNeedle(baseline);
  if (!needle) return;

  const [title, url] = needle.split("\n");
  const response = await fetcher(workerUrl, {
    headers: {
      "cache-control": "no-cache",
    },
  });
  const html = await response.text();
  if (response.ok && title && url && html.includes(title) && html.includes(url)) return;

  throw new CloudflareDeployError(
    "Cloudflare public site verification did not find a URL-only public item on the home route.",
    "verify.url_only_item_missing",
    { status: response.status, retryable: true },
  );
}

export async function deployCloudflarePublicSite({
  input,
  baseline,
  siteWebAssetsPath,
  fetch: fetcher = fetch,
  apiBaseUrl,
  workerBundle,
  now = () => new Date(),
  generateDeploySecret = generateCloudflareDeploySecret,
}: DeployCloudflarePublicSiteOptions): Promise<CloudflareDeployResult> {
  const validation = validateCloudflareDeployInput(input);
  if (!validation.ok) {
    throw new CloudflareDeployError("Cloudflare deploy settings are invalid.", "settings.invalid", {
      status: 400,
    });
  }

  const deploySecret = generateDeploySecret();
  const provisioned = await provisionCloudflarePublicSiteWorker({
    input: validation.value,
    deploySecret,
    siteWebAssetsPath,
    workerBundle,
    apiBaseUrl,
    fetch: fetcher,
  });
  const publish = await publishPublicSiteBaseline({
    workerUrl: provisioned.workerUrl,
    baseline,
    deploySecret,
    fetch: fetcher,
  });
  await verifyUrlOnlyPublicItem({
    baseline,
    fetcher,
    workerUrl: provisioned.workerUrl,
  });

  return {
    ok: true,
    state: "ready",
    metadata: {
      accountId: validation.value.accountId,
      workerName: provisioned.workerName,
      workerUrl: provisioned.workerUrl,
      durableObjectBinding: provisioned.durableObjectBinding,
      durableObjectClass: provisioned.durableObjectClass,
      sourceCursor: baseline.sourceCursor,
      baselineHash: publish.baselineHash,
      deployedAt: now().toISOString(),
      status: "ready",
    },
    publish,
  };
}
