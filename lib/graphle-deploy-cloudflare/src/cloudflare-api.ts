import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CloudflareDeployError,
  redactCloudflareDeploySecrets,
  type ValidatedCloudflareDeployInput,
} from "./contracts.js";

export const cloudflareApiBaseUrl = "https://api.cloudflare.com/client/v4";
export const cloudflarePublicSiteWorkerMainModule = "graphle-public-site-worker.js";
export const cloudflarePublicSiteWorkerCompatibilityDate = "2026-04-18";
export const cloudflarePublicSiteDurableObjectBindingName = "PUBLIC_SITE_BASELINE";
export const cloudflarePublicSiteDurableObjectClassName = "GraphlePublicSiteBaselineDurableObject";
export const cloudflarePublicSiteDurableObjectMigrationTag = "graphle-public-site-baseline-v1";
export const cloudflarePublicSiteAssetsBindingName = "ASSETS";
export const graphlePublicSiteStylesBindingName = "GRAPHLE_PUBLIC_SITE_STYLES";

export interface CloudflareWorkerBundle {
  readonly mainModule: string;
  readonly source: string;
}

export interface CloudflareWorkerStaticAssets {
  readonly completionJwt: string;
  readonly styles: readonly string[];
}

export interface CloudflareApiClientOptions {
  readonly accountId: string;
  readonly apiToken: string;
  readonly apiBaseUrl?: string;
  readonly fetch?: typeof fetch;
}

export interface ProvisionCloudflarePublicSiteWorkerOptions {
  readonly input: ValidatedCloudflareDeployInput;
  readonly deploySecret: string;
  readonly workerBundle?: CloudflareWorkerBundle;
  readonly siteWebAssetsPath?: string;
  readonly apiBaseUrl?: string;
  readonly fetch?: typeof fetch;
}

export interface ProvisionCloudflarePublicSiteWorkerResult {
  readonly workerName: string;
  readonly workerUrl: string;
  readonly durableObjectBinding: string;
  readonly durableObjectClass: string;
  readonly migrationTag: string;
  readonly uploaded: boolean;
}

type CloudflareEnvelope<T> = {
  readonly success?: boolean;
  readonly result?: T;
  readonly errors?: readonly { readonly code?: number | string; readonly message?: string }[];
  readonly messages?: readonly { readonly code?: number | string; readonly message?: string }[];
};

type CloudflareScriptSummary = {
  readonly id?: string;
  readonly script_name?: string;
  readonly migration_tag?: string;
};

type CloudflareSubdomainResult = {
  readonly subdomain?: string;
};

type CloudflareWorkerSubdomainResult = {
  readonly enabled?: boolean;
  readonly previews_enabled?: boolean;
};

type CloudflareAssetManifest = Record<string, { readonly hash: string; readonly size: number }>;

type CloudflareAssetUploadSession = {
  readonly jwt?: string;
  readonly buckets?: readonly (readonly string[])[];
};

type CloudflareAssetUploadResult = {
  readonly jwt?: string;
};

type SiteWebViteManifestEntry = {
  readonly file?: string;
  readonly css?: readonly string[];
  readonly isEntry?: boolean;
  readonly src?: string;
};

type SiteWebStaticAsset = {
  readonly hash: string;
  readonly size: number;
  readonly bytes: Uint8Array;
};

type SiteWebStaticAssets = {
  readonly manifest: CloudflareAssetManifest;
  readonly assetsByHash: Map<string, SiteWebStaticAsset>;
  readonly styles: readonly string[];
};

function encodedPathPart(value: string): string {
  return encodeURIComponent(value);
}

function firstCloudflareMessage(payload: CloudflareEnvelope<unknown> | undefined): string {
  const entries = [...(payload?.errors ?? []), ...(payload?.messages ?? [])];
  return (
    entries
      .map((entry) => entry.message)
      .find((message): message is string => typeof message === "string" && message.length > 0) ??
    "Cloudflare API request failed."
  );
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

async function parseEnvelope<T>(
  response: Response,
  apiToken: string,
  extraSecrets: readonly string[] = [],
): Promise<CloudflareEnvelope<T>> {
  const payload = (await response.json().catch(() => undefined)) as
    | CloudflareEnvelope<T>
    | undefined;
  if (!response.ok || payload?.success === false) {
    const message = redactCloudflareDeploySecrets(firstCloudflareMessage(payload), [
      apiToken,
      ...extraSecrets,
    ]);
    throw new CloudflareDeployError(message, "cloudflare.api_failed", {
      status: response.status,
      retryable: response.status === 429 || response.status >= 500,
    });
  }
  return payload ?? {};
}

function createRequestHeaders(apiToken: string, contentType?: string): Headers {
  const headers = new Headers({
    accept: "application/json",
    authorization: `Bearer ${apiToken}`,
  });
  if (contentType) headers.set("content-type", contentType);
  return headers;
}

function metadataBindingValues(
  deploySecret: string,
  staticAssets: CloudflareWorkerStaticAssets | undefined,
) {
  return [
    {
      name: cloudflarePublicSiteDurableObjectBindingName,
      type: "durable_object_namespace",
      class_name: cloudflarePublicSiteDurableObjectClassName,
    },
    {
      name: "GRAPHLE_DEPLOY_SECRET",
      type: "secret_text",
      text: deploySecret,
    },
    ...(staticAssets
      ? [
          {
            name: cloudflarePublicSiteAssetsBindingName,
            type: "assets",
          },
          ...(staticAssets.styles.length > 0
            ? [
                {
                  name: graphlePublicSiteStylesBindingName,
                  type: "plain_text",
                  text: JSON.stringify(staticAssets.styles),
                },
              ]
            : []),
        ]
      : []),
  ];
}

export function createCloudflarePublicSiteWorkerUploadMetadata({
  deploySecret,
  includeDurableObjectMigration,
  staticAssets,
}: {
  readonly deploySecret: string;
  readonly includeDurableObjectMigration: boolean;
  readonly staticAssets?: CloudflareWorkerStaticAssets;
}) {
  return {
    main_module: cloudflarePublicSiteWorkerMainModule,
    compatibility_date: cloudflarePublicSiteWorkerCompatibilityDate,
    bindings: metadataBindingValues(deploySecret, staticAssets),
    ...(staticAssets
      ? {
          assets: {
            jwt: staticAssets.completionJwt,
          },
        }
      : {}),
    ...(includeDurableObjectMigration
      ? {
          migrations: {
            new_tag: cloudflarePublicSiteDurableObjectMigrationTag,
            new_sqlite_classes: [cloudflarePublicSiteDurableObjectClassName],
          },
        }
      : {}),
  };
}

export function createCloudflareWorkerUploadFormData({
  bundle,
  deploySecret,
  includeDurableObjectMigration,
  staticAssets,
}: {
  readonly bundle: CloudflareWorkerBundle;
  readonly deploySecret: string;
  readonly includeDurableObjectMigration: boolean;
  readonly staticAssets?: CloudflareWorkerStaticAssets;
}): FormData {
  const form = new FormData();
  form.append(
    "metadata",
    JSON.stringify(
      createCloudflarePublicSiteWorkerUploadMetadata({
        deploySecret,
        includeDurableObjectMigration,
        staticAssets,
      }),
    ),
  );
  form.append(
    bundle.mainModule,
    new Blob([bundle.source], { type: "application/javascript+module" }),
    bundle.mainModule,
  );
  return form;
}

function isViteManifestEntry(value: unknown): value is SiteWebViteManifestEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    (entry.file === undefined || typeof entry.file === "string") &&
    (entry.src === undefined || typeof entry.src === "string") &&
    (entry.isEntry === undefined || typeof entry.isEntry === "boolean") &&
    (entry.css === undefined ||
      (Array.isArray(entry.css) && entry.css.every((item) => typeof item === "string")))
  );
}

function pickViteEntry(
  entries: readonly SiteWebViteManifestEntry[],
): SiteWebViteManifestEntry | undefined {
  return (
    entries.find((entry) => entry.isEntry && entry.src === "index.html") ??
    entries.find((entry) => entry.isEntry) ??
    entries[0]
  );
}

function assetPublicPath(relativePath: string): string {
  return `/${relativePath.replaceAll(sep, "/")}`;
}

function assetHash(bytes: Uint8Array, path: string): string {
  const extension = extname(path).replace(/^\./, "");
  return createHash("sha256")
    .update(Buffer.from(bytes).toString("base64") + extension)
    .digest("hex")
    .slice(0, 32);
}

function shouldUploadSiteWebAsset(relativePath: string): boolean {
  const normalized = relativePath.replaceAll(sep, "/");
  return (
    normalized.startsWith("assets/") ||
    normalized === "favicon.ico" ||
    normalized === "manifest.webmanifest"
  );
}

async function readSiteWebStyleAssetPaths(root: string): Promise<readonly string[]> {
  const manifestPath = join(root, ".vite", "manifest.json");

  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
    if (!manifest || typeof manifest !== "object") return [];
    const entry = pickViteEntry(Object.values(manifest).filter(isViteManifestEntry));
    return (entry?.css ?? []).map((path) => (path.startsWith("/") ? path : `/${path}`));
  } catch {
    return [];
  }
}

async function collectSiteWebStaticAssets(root: string): Promise<SiteWebStaticAssets | undefined> {
  const assetsByHash = new Map<string, SiteWebStaticAsset>();
  const manifest: CloudflareAssetManifest = {};

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true, encoding: "utf8" }).catch(
      (error: unknown) => {
        if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return undefined;
        throw error;
      },
    );
    if (!entries) return;

    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      if (!entry.isFile()) continue;

      const relativePath = relative(root, path);
      if (!shouldUploadSiteWebAsset(relativePath)) continue;

      const bytes = await readFile(path);
      const publicPath = assetPublicPath(relativePath);
      const hash = assetHash(bytes, publicPath);
      const asset = {
        hash,
        size: bytes.byteLength,
        bytes,
      } satisfies SiteWebStaticAsset;
      assetsByHash.set(hash, asset);
      manifest[publicPath] = {
        hash,
        size: bytes.byteLength,
      };
    }
  }

  await walk(root);

  if (assetsByHash.size === 0) return undefined;

  return {
    assetsByHash,
    manifest,
    styles: await readSiteWebStyleAssetPaths(root),
  };
}

function createAssetUploadFormData(payload: Record<string, string>): FormData {
  const form = new FormData();
  form.append("body", JSON.stringify(payload));
  return form;
}

async function existingWorkerEntrypoint(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "worker.ts"), join(here, "worker.js")];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  throw new CloudflareDeployError(
    "The Cloudflare public site Worker entrypoint was not found.",
    "worker.entrypoint_missing",
  );
}

export async function buildCloudflarePublicSiteWorkerBundle(): Promise<CloudflareWorkerBundle> {
  if (!("Bun" in globalThis)) {
    throw new CloudflareDeployError(
      "Cloudflare Worker bundle generation requires the Bun runtime.",
      "worker.bundle_runtime_missing",
    );
  }

  const result = await Bun.build({
    entrypoints: [await existingWorkerEntrypoint()],
    format: "esm",
    minify: true,
    target: "browser",
  });

  if (!result.success || !result.outputs[0]) {
    const message = result.logs.map((entry) => entry.message).join(" ");
    throw new CloudflareDeployError(
      message || "Cloudflare Worker bundle generation failed.",
      "worker.bundle_failed",
    );
  }

  return {
    mainModule: cloudflarePublicSiteWorkerMainModule,
    source: await result.outputs[0].text(),
  };
}

export function createCloudflareApiClient({
  accountId,
  apiToken,
  apiBaseUrl = cloudflareApiBaseUrl,
  fetch: fetcher = fetch,
}: CloudflareApiClientOptions) {
  function endpoint(path: string): string {
    return `${apiBaseUrl}/accounts/${encodedPathPart(accountId)}${path}`;
  }

  async function jsonRequest<T>(path: string, init: Omit<RequestInit, "headers"> = {}): Promise<T> {
    const response = await fetcher(endpoint(path), {
      ...init,
      headers: createRequestHeaders(apiToken, "application/json"),
    });
    const envelope = await parseEnvelope<T>(response, apiToken);
    return envelope.result as T;
  }

  async function listWorkerScripts(): Promise<readonly CloudflareScriptSummary[]> {
    const result = await jsonRequest<readonly CloudflareScriptSummary[]>("/workers/scripts");
    return Array.isArray(result) ? result : [];
  }

  async function createAssetUploadSession(
    workerName: string,
    manifest: CloudflareAssetManifest,
  ): Promise<CloudflareAssetUploadSession> {
    return await jsonRequest<CloudflareAssetUploadSession>(
      `/workers/scripts/${encodedPathPart(workerName)}/assets-upload-session`,
      {
        method: "POST",
        body: JSON.stringify({ manifest }),
      },
    );
  }

  async function uploadAssetPayload(
    uploadJwt: string,
    payload: Record<string, string>,
  ): Promise<CloudflareAssetUploadResult> {
    const response = await fetcher(endpoint("/workers/assets/upload?base64=true"), {
      method: "POST",
      headers: createRequestHeaders(uploadJwt),
      body: createAssetUploadFormData(payload),
    });
    const envelope = await parseEnvelope<CloudflareAssetUploadResult>(response, uploadJwt, [
      apiToken,
    ]);
    return isObjectRecord(envelope.result) ? envelope.result : {};
  }

  async function uploadWorkerModule({
    deploySecret,
    existingMigrationTag,
    staticAssets,
    workerBundle,
    workerName,
  }: {
    readonly deploySecret: string;
    readonly existingMigrationTag?: string;
    readonly staticAssets?: CloudflareWorkerStaticAssets;
    readonly workerBundle: CloudflareWorkerBundle;
    readonly workerName: string;
  }): Promise<CloudflareScriptSummary> {
    const form = createCloudflareWorkerUploadFormData({
      bundle: workerBundle,
      deploySecret,
      includeDurableObjectMigration:
        existingMigrationTag !== cloudflarePublicSiteDurableObjectMigrationTag,
      staticAssets,
    });
    const response = await fetcher(endpoint(`/workers/scripts/${encodedPathPart(workerName)}`), {
      method: "PUT",
      headers: createRequestHeaders(apiToken),
      body: form,
    });
    const envelope = await parseEnvelope<CloudflareScriptSummary>(response, apiToken);
    return isObjectRecord(envelope.result) ? envelope.result : {};
  }

  async function enableWorkerSubdomain(
    workerName: string,
  ): Promise<CloudflareWorkerSubdomainResult> {
    return await jsonRequest<CloudflareWorkerSubdomainResult>(
      `/workers/scripts/${encodedPathPart(workerName)}/subdomain`,
      {
        method: "POST",
        body: JSON.stringify({
          enabled: true,
          previews_enabled: false,
        }),
      },
    );
  }

  async function getAccountSubdomain(): Promise<string> {
    const result = await jsonRequest<CloudflareSubdomainResult>("/workers/subdomain");
    if (!result?.subdomain) {
      throw new CloudflareDeployError(
        "Cloudflare account does not have a workers.dev subdomain configured.",
        "cloudflare.subdomain_missing",
        { status: 400 },
      );
    }
    return result.subdomain;
  }

  return {
    listWorkerScripts,
    createAssetUploadSession,
    uploadAssetPayload,
    uploadWorkerModule,
    enableWorkerSubdomain,
    getAccountSubdomain,
  };
}

async function uploadCloudflareSiteWebAssets({
  client,
  siteWebAssetsPath,
  workerName,
}: {
  readonly client: ReturnType<typeof createCloudflareApiClient>;
  readonly siteWebAssetsPath: string | undefined;
  readonly workerName: string;
}): Promise<CloudflareWorkerStaticAssets | undefined> {
  if (!siteWebAssetsPath) return undefined;
  const staticAssets = await collectSiteWebStaticAssets(siteWebAssetsPath);
  if (!staticAssets) return undefined;

  const uploadSession = await client.createAssetUploadSession(workerName, staticAssets.manifest);
  if (!uploadSession.jwt) {
    throw new CloudflareDeployError(
      "Cloudflare static asset upload session did not return an upload token.",
      "cloudflare.assets_upload_failed",
      { retryable: true },
    );
  }

  let completionJwt = uploadSession.jwt;
  for (const bucket of uploadSession.buckets ?? []) {
    const payload: Record<string, string> = {};
    for (const hash of bucket) {
      const asset = staticAssets.assetsByHash.get(hash);
      if (!asset) {
        throw new CloudflareDeployError(
          `Cloudflare static asset upload requested unknown asset hash "${hash}".`,
          "cloudflare.assets_upload_failed",
          { retryable: true },
        );
      }
      payload[hash] = Buffer.from(asset.bytes).toString("base64");
    }
    if (Object.keys(payload).length === 0) continue;

    const uploadResult = await client.uploadAssetPayload(uploadSession.jwt, payload);
    if (uploadResult.jwt) completionJwt = uploadResult.jwt;
  }

  return {
    completionJwt,
    styles: staticAssets.styles,
  };
}

export async function provisionCloudflarePublicSiteWorker({
  input,
  deploySecret,
  workerBundle,
  siteWebAssetsPath,
  apiBaseUrl,
  fetch: fetcher,
}: ProvisionCloudflarePublicSiteWorkerOptions): Promise<ProvisionCloudflarePublicSiteWorkerResult> {
  const bundle = workerBundle ?? (await buildCloudflarePublicSiteWorkerBundle());
  const client = createCloudflareApiClient({
    accountId: input.accountId,
    apiToken: input.apiToken,
    apiBaseUrl,
    fetch: fetcher,
  });
  const existing = (await client.listWorkerScripts()).find(
    (script) => script.id === input.workerName || script.script_name === input.workerName,
  );
  const staticAssets = await uploadCloudflareSiteWebAssets({
    client,
    siteWebAssetsPath,
    workerName: input.workerName,
  });
  const uploaded = await client.uploadWorkerModule({
    deploySecret,
    existingMigrationTag: existing?.migration_tag,
    staticAssets,
    workerBundle: bundle,
    workerName: input.workerName,
  });
  await client.enableWorkerSubdomain(input.workerName);
  const subdomain = await client.getAccountSubdomain();

  return {
    workerName: input.workerName,
    workerUrl: `https://${input.workerName}.${subdomain}.workers.dev`,
    durableObjectBinding: cloudflarePublicSiteDurableObjectBindingName,
    durableObjectClass: cloudflarePublicSiteDurableObjectClassName,
    migrationTag:
      uploaded.migration_tag ??
      existing?.migration_tag ??
      cloudflarePublicSiteDurableObjectMigrationTag,
    uploaded: true,
  };
}
