import assert from "node:assert/strict";
import test from "node:test";
import { cookieHeader, createSessionCookie, verifySessionCookie } from "../src/lib/session";

const secret = "a-secure-test-secret-that-is-long-enough";
const workspaceId = "4cf20e0d-2e2f-43b4-a1b5-ed7f3e55b2af";

test("signed sandbox session survives verification", () => {
  const token = createSessionCookie(secret, workspaceId, 1_700_000_000_000);
  assert.equal(verifySessionCookie(token, secret, 1_700_000_001_000), workspaceId);
});

test("tampered and expired sessions are rejected", () => {
  const token = createSessionCookie(secret, workspaceId, 1_700_000_000_000);
  assert.equal(verifySessionCookie(`${token}x`, secret, 1_700_000_001_000), null);
  assert.equal(verifySessionCookie(token, secret, 1_700_086_401_000), null);
});

test("cookie uses production security flags", () => {
  const header = cookieHeader("token");
  assert.match(header, /HttpOnly/);
  assert.match(header, /Secure/);
  assert.match(header, /SameSite=Lax/);
  assert.match(header, /Max-Age=86400/);
});
