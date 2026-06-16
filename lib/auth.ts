import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

export const INTERNAL_ACCESS_COOKIE_NAME = "kloudvestigate.internal-access";

const SESSION_VERSION = "v1";
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_SECONDS * 1000;

type InternalAccessSession = {
  issuedAt: number;
  expiresAt: number;
};

export function assertInternalAccess(request: Request): Response | null {
  if (!isInternalAccessRequired()) {
    return null;
  }

  const expected = getInternalAccessToken();

  if (!expected) {
    return Response.json(
      {
        error: "Access token is not configured",
        message: "Set INTERNAL_ACCESS_TOKEN before exposing this deployment.",
      },
      { status: 503 },
    );
  }

  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const internalHeader = request.headers.get("x-internal-access-token");

  if (matchesSecret(bearer, expected) || matchesSecret(internalHeader, expected)) {
    return null;
  }

  if (verifyInternalAccessCookie(readCookieFromRequest(request, INTERNAL_ACCESS_COOKIE_NAME))) {
    return null;
  }

  return Response.json(
    { error: "Unauthorized", message: "Internal telemetry access is required." },
    { status: 401 },
  );
}

export async function hasInternalAccessSession(): Promise<boolean> {
  if (!isInternalAccessRequired()) {
    return true;
  }

  return verifyInternalAccessCookie(
    (await cookies()).get(INTERNAL_ACCESS_COOKIE_NAME)?.value,
  );
}

export function verifyInternalAccessPassword(password: string): boolean {
  const expected = getInternalAccessToken();
  return Boolean(expected && matchesSecret(password, expected));
}

export function isInternalAccessConfigured() {
  return Boolean(getInternalAccessToken());
}

export function isInternalAccessMisconfigured() {
  return process.env.NODE_ENV === "production" && !isInternalAccessConfigured();
}

export function createInternalAccessSessionCookie() {
  const now = Date.now();
  const session: InternalAccessSession = {
    issuedAt: now,
    expiresAt: now + SESSION_MAX_AGE_MS,
  };

  return {
    name: INTERNAL_ACCESS_COOKIE_NAME,
    value: signSession(session),
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    },
  };
}

export function clearInternalAccessSessionCookie() {
  return {
    name: INTERNAL_ACCESS_COOKIE_NAME,
    value: "",
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: "/",
      maxAge: 0,
    },
  };
}

function isInternalAccessRequired() {
  return process.env.NODE_ENV === "production" || Boolean(getInternalAccessToken());
}

function getInternalAccessToken() {
  return process.env.INTERNAL_ACCESS_TOKEN?.trim();
}

function signSession(session: InternalAccessSession) {
  const payload = toBase64Url(JSON.stringify(session));
  const signature = signPayload(payload);
  return `${SESSION_VERSION}.${payload}.${signature}`;
}

function verifyInternalAccessCookie(cookieValue?: string | null): boolean {
  const expected = getInternalAccessToken();
  if (!expected || !cookieValue) return false;

  const [version, payload, signature] = cookieValue.split(".");
  if (version !== SESSION_VERSION || !payload || !signature) return false;

  if (!matchesSecret(signature, signPayload(payload))) return false;

  try {
    const session = JSON.parse(fromBase64Url(payload)) as Partial<InternalAccessSession>;
    return typeof session.expiresAt === "number" && session.expiresAt > Date.now();
  } catch {
    return false;
  }
}

function signPayload(payload: string) {
  const token = getInternalAccessToken();
  if (!token) return "";
  return createHmac("sha256", token).update(payload).digest("base64url");
}

function matchesSecret(value: string | null | undefined, expected: string) {
  if (!value) return false;

  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);
  return valueBuffer.length === expectedBuffer.length && timingSafeEqual(valueBuffer, expectedBuffer);
}

function readCookieFromRequest(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${escapeRegExp(name)}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

export function writeAuditEvent(event: Record<string, unknown>): void {
  console.info(
    JSON.stringify({
      type: "telemetry_investigation_audit",
      occurredAt: new Date().toISOString(),
      ...event,
    }),
  );
}
