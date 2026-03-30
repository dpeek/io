const localhostBootstrapTokenPattern = /^io_local_bootstrap_[0-9a-f]{64}$/;
const localhostSyntheticIdentityIdPattern = /^local:([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/;

export const localhostBootstrapTokenPrefix = "io_local_bootstrap_";
export const localhostBootstrapCredentialMaxTtlMs = 5 * 60 * 1000;
export const localhostSyntheticEmailDomain = "localhost.invalid";
export const localhostBootstrapIssuePath = "/api/local-bootstrap/issue";
export const localhostBootstrapRedeemPath = "/api/local-bootstrap/redeem";
export const defaultLocalhostSyntheticIdentityId = "local:default";
export const defaultLocalhostSyntheticDisplayName = "Local Operator";

export type LocalhostSyntheticIdentity = {
  readonly localIdentityId: string;
  readonly email: string;
  readonly displayName: string;
};

export type LocalhostBootstrapCredential = {
  readonly kind: "localhost-bootstrap";
  readonly availability: "localhost-only";
  readonly token: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly redeemOrigin: string;
  readonly oneTimeUse: true;
  readonly syntheticIdentity: LocalhostSyntheticIdentity;
};

function encodeHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function assertNonEmptyString(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
}

function parseContractTimestamp(value: string, label: string): number {
  assertNonEmptyString(value, label);

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new TypeError(`${label} must be a valid ISO-8601 timestamp.`);
  }

  return timestamp;
}

function parseOrigin(value: string, label: string): URL {
  assertNonEmptyString(value, label);

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${label} must be a valid origin URL.`);
  }

  if (url.origin === "null") {
    throw new TypeError(`${label} must be a valid origin URL.`);
  }

  if (url.origin !== value) {
    throw new TypeError(`${label} must not include a path, query, or hash.`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError(`${label} must use the http or https protocol.`);
  }

  return url;
}

function parseLocalIdentitySlug(localIdentityId: string): string {
  assertNonEmptyString(localIdentityId, "localIdentityId");

  const match = localhostSyntheticIdentityIdPattern.exec(localIdentityId);
  if (!match) {
    throw new TypeError('localIdentityId must use the "local:<slug>" format.');
  }

  const slug = match[1];
  if (!slug) {
    throw new TypeError('localIdentityId must use the "local:<slug>" format.');
  }

  return slug;
}

export function createLocalhostSyntheticEmail(localIdentityId: string): string {
  const slug = parseLocalIdentitySlug(localIdentityId);
  return `local+${slug}@${localhostSyntheticEmailDomain}`;
}

export function createLocalhostBootstrapToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `${localhostBootstrapTokenPrefix}${encodeHex(bytes)}`;
}

export function isLocalhostBootstrapToken(token: string): boolean {
  return localhostBootstrapTokenPattern.test(token);
}

export function isLocalhostOrigin(origin: string): boolean {
  try {
    const hostname = parseOrigin(origin, "origin").hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

export function defineLocalhostSyntheticIdentity<const T extends LocalhostSyntheticIdentity>(
  identity: T,
): Readonly<T> {
  parseLocalIdentitySlug(identity.localIdentityId);
  assertNonEmptyString(identity.displayName, "displayName");

  const expectedEmail = createLocalhostSyntheticEmail(identity.localIdentityId);
  if (identity.email !== expectedEmail) {
    throw new TypeError(`email must match the synthetic local identity email "${expectedEmail}".`);
  }

  return Object.freeze({
    ...identity,
  }) as Readonly<T>;
}

export function createDefaultLocalhostSyntheticIdentity(): Readonly<LocalhostSyntheticIdentity> {
  return defineLocalhostSyntheticIdentity({
    localIdentityId: defaultLocalhostSyntheticIdentityId,
    email: createLocalhostSyntheticEmail(defaultLocalhostSyntheticIdentityId),
    displayName: defaultLocalhostSyntheticDisplayName,
  });
}

export function defineLocalhostBootstrapCredential<const T extends LocalhostBootstrapCredential>(
  credential: T,
): Readonly<T> {
  if (credential.kind !== "localhost-bootstrap") {
    throw new TypeError('kind must be "localhost-bootstrap".');
  }

  if (credential.availability !== "localhost-only") {
    throw new TypeError('availability must be "localhost-only".');
  }

  if (credential.oneTimeUse !== true) {
    throw new TypeError("oneTimeUse must be true.");
  }

  if (!isLocalhostBootstrapToken(credential.token)) {
    throw new TypeError(
      `token must use the issued ${localhostBootstrapTokenPrefix}<64 lowercase hex chars> format.`,
    );
  }

  const issuedAt = parseContractTimestamp(credential.issuedAt, "issuedAt");
  const expiresAt = parseContractTimestamp(credential.expiresAt, "expiresAt");
  if (expiresAt <= issuedAt) {
    throw new TypeError("expiresAt must be later than issuedAt.");
  }

  if (expiresAt - issuedAt > localhostBootstrapCredentialMaxTtlMs) {
    throw new TypeError(
      `expiresAt must be within ${localhostBootstrapCredentialMaxTtlMs}ms of issuedAt.`,
    );
  }

  if (!isLocalhostOrigin(credential.redeemOrigin)) {
    throw new TypeError(
      "redeemOrigin must target localhost, a *.localhost host, 127.0.0.1, or [::1].",
    );
  }

  return Object.freeze({
    ...credential,
    syntheticIdentity: defineLocalhostSyntheticIdentity(credential.syntheticIdentity),
  }) as Readonly<T>;
}
