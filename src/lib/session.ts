import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const MAX_AGE_SECONDS = 86_400;

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionCookie(secret: string, workspaceId: string = randomUUID(), now = Date.now()) {
  const payload = `${workspaceId}.${Math.floor(now / 1000) + MAX_AGE_SECONDS}`;
  return `${payload}.${signature(payload, secret)}`;
}

export function verifySessionCookie(value: string | undefined, secret: string, now = Date.now()) {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [workspaceId, expiresAt, received] = parts;
  const payload = `${workspaceId}.${expiresAt}`;
  const expected = Buffer.from(signature(payload, secret));
  const actual = Buffer.from(received);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  if (!Number.isFinite(Number(expiresAt)) || Number(expiresAt) * 1000 <= now) return null;
  return workspaceId;
}

export function cookieHeader(value: string) {
  return `recallops_session=${value}; Max-Age=${MAX_AGE_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}
