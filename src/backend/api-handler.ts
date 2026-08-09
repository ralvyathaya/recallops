import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { cookieHeader, createSessionCookie, verifySessionCookie } from "@/lib/session";
import { sessionSecret } from "./secrets";
import { service } from "./service";

const uuid = z.string().uuid();
const decisionBody = z.object({ decision: z.enum(["approve", "reject"]) });

function cookieValue(header: string | undefined, name: string) {
  return header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

function response(statusCode: number, traceId: string, data: unknown, options?: { degraded?: string[]; cookie?: string; error?: { code: string; message: string } }) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(options?.cookie ? { "set-cookie": options.cookie } : {}),
    },
    body: JSON.stringify({ data, traceId, ...(options?.degraded?.length ? { degraded: options.degraded } : {}), ...(options?.error ? { error: options.error } : {}) }),
  };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const traceId = event.requestContext.requestId || crypto.randomUUID();
  const path = event.rawPath.replace(/\/$/, "") || "/";
  const method = event.requestContext.http.method;
  try {
    const secret = await sessionSecret();
    if (method === "POST" && path === "/api/session") {
      const existing = cookieValue(event.headers.cookie, "recallops_session");
      const verified = verifySessionCookie(existing, secret);
      const workspaceId = verified ?? randomUUID();
      const token = verified && existing ? existing : createSessionCookie(secret, workspaceId);
      const state = await service.startSession(workspaceId);
      return response(200, traceId, state, { cookie: cookieHeader(token) });
    }

    const token = cookieValue(event.headers.cookie, "recallops_session");
    const sessionWorkspaceId = verifySessionCookie(token, secret);
    if (!sessionWorkspaceId) return response(401, traceId, null, { error: { code: "SESSION_REQUIRED", message: "Start or resume a sandbox session first" } });
    const workspaceId = uuid.parse(sessionWorkspaceId);

    if (method === "GET" && path === "/api/state") {
      return response(200, traceId, await service.getState(workspaceId));
    }
    if (method === "POST" && path === "/api/demo/trigger") {
      const result = await service.triggerDemo(workspaceId, traceId);
      return response(202, traceId, result, { degraded: result.degraded });
    }
    if (method === "POST" && path === "/api/session/reset") {
      await service.resetWorkspace(workspaceId);
      return response(200, traceId, await service.getState(workspaceId));
    }

    let match = path.match(/^\/api\/incidents\/([^/]+)\/recall$/);
    if (method === "POST" && match) {
      const result = await service.recallIncident(workspaceId, uuid.parse(match[1]));
      return response(200, traceId, { ...result, state: await service.getState(workspaceId) }, { degraded: result.degraded });
    }
    match = path.match(/^\/api\/actions\/([^/]+)\/decision$/);
    if (method === "POST" && match) {
      const body = decisionBody.parse(JSON.parse(event.body ?? "{}"));
      await service.decideAction(workspaceId, uuid.parse(match[1]), body.decision);
      return response(200, traceId, await service.getState(workspaceId));
    }
    match = path.match(/^\/api\/actions\/([^/]+)\/complete$/);
    if (method === "POST" && match) {
      await service.completeAction(workspaceId, uuid.parse(match[1]));
      return response(200, traceId, await service.getState(workspaceId));
    }
    match = path.match(/^\/api\/incidents\/([^/]+)\/resolve$/);
    if (method === "POST" && match) {
      const result = await service.resolveWithPostmortem(workspaceId, uuid.parse(match[1]));
      return response(200, traceId, await service.getState(workspaceId), { degraded: result.degraded });
    }
    match = path.match(/^\/api\/memories\/([^/]+)\/verify$/);
    if (method === "POST" && match) {
      await service.verifyMemory(workspaceId, uuid.parse(match[1]));
      return response(200, traceId, await service.getState(workspaceId));
    }
    return response(404, traceId, null, { error: { code: "NOT_FOUND", message: "Route not found" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    const status = message.includes("rate limit") ? 429 : message.includes("not found") ? 404 : message.includes("already") || message.includes("must be") ? 409 : 500;
    console.error(JSON.stringify({ traceId, stage: "api_error", error: message }));
    return response(status, traceId, null, { error: { code: status === 429 ? "RATE_LIMITED" : "REQUEST_FAILED", message } });
  }
};
