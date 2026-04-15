import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const graphleAdminCookieName = "graphle_admin";
export const graphleAdminCookieMaxAgeSeconds = 60 * 60 * 24 * 30;

export interface LocalAdminSession {
  readonly projectId: string;
  readonly subject: "local-admin";
  readonly issuedAt: string;
}

export interface LocalAuthController {
  readonly initToken: string;
  getSession(cookieHeader: string | null): LocalAdminSession | null;
  redeemInitToken(
    token: string | null,
    cookieHeader: string | null,
  ): LocalInitTokenRedemptionResult;
}

export type LocalInitTokenRedemptionResult =
  | {
      readonly ok: true;
      readonly alreadyAuthenticated: boolean;
      readonly setCookie?: string;
    }
  | {
      readonly ok: false;
      readonly code: "auth.init_token_invalid";
      readonly message: string;
    };

export interface CreateLocalAuthControllerOptions {
  readonly authSecret: string;
  readonly projectId: string;
  readonly initToken?: string;
  readonly now?: () => Date;
}

function createInitToken(): string {
  return randomBytes(32).toString("base64url");
}

function encodePayload(payload: LocalAdminSession): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(payload: string): LocalAdminSession | null {
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
    if (!isLocalAdminSession(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function signaturesMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isLocalAdminSession(value: unknown): value is LocalAdminSession {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as LocalAdminSession).subject === "local-admin" &&
    typeof (value as LocalAdminSession).projectId === "string" &&
    typeof (value as LocalAdminSession).issuedAt === "string"
  );
}

export function signLocalAdminSession(session: LocalAdminSession, secret: string): string {
  const payload = encodePayload(session);
  return `${payload}.${signPayload(payload, secret)}`;
}

export function verifyLocalAdminSession(
  value: string | undefined,
  secret: string,
): LocalAdminSession | null {
  if (!value) {
    return null;
  }
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra !== undefined) {
    return null;
  }
  const expectedSignature = signPayload(payload, secret);
  if (!signaturesMatch(signature, expectedSignature)) {
    return null;
  }
  return decodePayload(payload);
}

export function parseCookieHeader(cookieHeader: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!cookieHeader) {
    return cookies;
  }
  for (const part of cookieHeader.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key.length > 0 && !cookies.has(key)) {
      cookies.set(key, value);
    }
  }
  return cookies;
}

export function serializeLocalAdminCookie(value: string): string {
  return [
    `${graphleAdminCookieName}=${value}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${graphleAdminCookieMaxAgeSeconds}`,
  ].join("; ");
}

export function createLocalAuthController({
  authSecret,
  projectId,
  initToken = createInitToken(),
  now = () => new Date(),
}: CreateLocalAuthControllerOptions): LocalAuthController {
  let consumed = false;

  function createCookie(): string {
    return serializeLocalAdminCookie(
      signLocalAdminSession(
        {
          projectId,
          subject: "local-admin",
          issuedAt: now().toISOString(),
        },
        authSecret,
      ),
    );
  }

  function getSession(cookieHeader: string | null): LocalAdminSession | null {
    return verifyLocalAdminSession(
      parseCookieHeader(cookieHeader).get(graphleAdminCookieName),
      authSecret,
    );
  }

  return {
    initToken,
    getSession,
    redeemInitToken(token, cookieHeader) {
      if (getSession(cookieHeader)) {
        return {
          ok: true,
          alreadyAuthenticated: true,
        };
      }
      if (!token || token !== initToken || consumed) {
        return {
          ok: false,
          code: "auth.init_token_invalid",
          message: "The local admin init token is invalid or has already been used.",
        };
      }
      consumed = true;
      return {
        ok: true,
        alreadyAuthenticated: false,
        setCookie: createCookie(),
      };
    },
  };
}
