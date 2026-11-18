import { createHmac } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { signVapiPublicToken } from "./jwt.js";
import type { CallQuota, QuotaScope } from "./quota.js";

/**
 * jwt: the server signs a 30-second token per call with the private key (preferred).
 * public-key: fallback when the private key is not on the server. The public key is
 * handed out only after the limit check, and is restricted in Vapi to this origin and
 * assistant, but someone who copies it can still start calls outside the limit.
 */
export type WebCallAuth =
  | { mode: "jwt"; privateKey: string; orgId: string }
  | { mode: "public-key"; publicKey: string };

export type WebCallDeps = {
  quota: CallQuota;
  auth: WebCallAuth;
  assistantId: string;
  allowedOrigins: string[];
  tokenTtlSeconds: number;
  perVisitor: number;
  /** Key for hashing visitor IPs, so raw IPs are not stored. */
  hashKey: string;
  trustProxyHeaders: boolean;
  now: () => Date;
};

export function clientIp(request: FastifyRequest, trustProxyHeaders: boolean): string {
  if (trustProxyHeaders) {
    const real = request.headers["x-real-ip"];
    if (typeof real === "string" && real.trim()) return real.trim();
    const forwarded = request.headers["x-forwarded-for"];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.ip;
}

function hours(seconds: number): string {
  const h = Math.ceil(seconds / 3600);
  return h <= 1 ? "about an hour" : `about ${h} hours`;
}

function limitMessage(scope: QuotaScope, retryAfterSeconds: number, perVisitor: number): string {
  if (scope === "visitor") {
    return `You have used the ${perVisitor} demo calls allowed per visitor in 24 hours. Please try again in ${hours(retryAfterSeconds)}.`;
  }
  if (scope === "global") return "The demo has reached its call limit for today. Please try again tomorrow.";
  return "The demo cannot start a call right now. Please try again in a minute.";
}

export async function registerWebCallRoutes(app: FastifyInstance, deps: WebCallDeps | null): Promise<void> {
  app.post("/api/call-token", async (request, reply) => {
    reply.header("cache-control", "no-store");
    if (!deps) {
      return reply.code(503).send({ error: "web_calls_disabled", message: "Browser calls are not configured on this server." });
    }
    const origin = request.headers.origin;
    if (origin && !deps.allowedOrigins.includes(origin)) {
      return reply.code(403).send({ error: "origin_not_allowed", message: "Calls can only be started from the demo page." });
    }
    const ip = clientIp(request, deps.trustProxyHeaders);
    const visitorKey = createHmac("sha256", deps.hashKey).update(`visitor:${ip}`).digest("hex").slice(0, 32);
    const now = deps.now();
    const result = await deps.quota.acquire({ visitorKey, clientIp: ip, now });
    if (!result.ok) {
      reply.header("retry-after", String(result.retryAfterSeconds));
      return reply.code(result.scope === "unavailable" ? 503 : 429).send({
        error: result.scope === "unavailable" ? "quota_unavailable" : "call_limit_reached",
        scope: result.scope,
        retryAfterSeconds: result.retryAfterSeconds,
        message: limitMessage(result.scope, result.retryAfterSeconds, deps.perVisitor),
      });
    }
    if (deps.auth.mode === "public-key") {
      return reply.code(200).send({
        token: deps.auth.publicKey,
        mode: "public-key",
        assistantId: deps.assistantId,
        callsLeft: result.visitorRemaining,
      });
    }
    const signed = signVapiPublicToken({
      privateKey: deps.auth.privateKey,
      orgId: deps.auth.orgId,
      assistantId: deps.assistantId,
      allowedOrigins: deps.allowedOrigins,
      ttlSeconds: deps.tokenTtlSeconds,
      now,
    });
    return reply.code(200).send({
      token: signed.token,
      mode: "jwt",
      assistantId: deps.assistantId,
      expiresAt: signed.expiresAt,
      callsLeft: result.visitorRemaining,
    });
  });
}
