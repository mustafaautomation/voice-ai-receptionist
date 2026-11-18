import { createHmac } from "node:crypto";
import { describe, expect, test } from "vitest";
import { buildApp } from "../../src/app.js";
import { MemoryCallQuota } from "../../src/webcall/quota.js";
import { memoryDb, NOW, testConfig } from "../helpers.js";

const KEY = "test-private-key-not-real";
const ASSISTANT = "f81cca1a-7ef5-40d2-91c2-88065f88fef7";
const ORIGIN = "https://voice.example.test";

function decode(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

async function app(overrides: Parameters<typeof testConfig>[0] = {}) {
  return buildApp({
    config: testConfig({
      vapiApiKey: KEY,
      vapiOrgId: "b3842fb3-91c5-4d9b-97a1-5d8816f993c0",
      vapiAssistantId: ASSISTANT,
      webCallOrigins: [ORIGIN],
      trustProxyHeaders: true,
      ...overrides,
    }),
    db: memoryDb(),
    callQuota: new MemoryCallQuota({ perVisitor: 3, perDay: 40 }),
    now: () => NOW,
  });
}

const post = (ip: string, origin = ORIGIN) => ({
  method: "POST" as const,
  url: "/api/call-token",
  headers: { origin, "x-forwarded-for": `${ip}, 10.0.0.1` },
});

describe("POST /api/call-token", () => {
  test("issues a short-lived, origin and assistant locked token, then blocks the fourth call", async () => {
    const server = await app();
    const first = await server.inject(post("203.0.113.5"));
    expect(first.statusCode).toBe(200);
    expect(first.headers["cache-control"]).toBe("no-store");
    const body = first.json() as { token: string; assistantId: string; callsLeft: number; expiresAt: number };
    expect(body).toMatchObject({ assistantId: ASSISTANT, callsLeft: 2, mode: "jwt" });
    expect(JSON.stringify(body)).not.toContain(KEY);

    const [header, payload, signature] = body.token.split(".");
    expect(decode(header ?? "")).toEqual({ alg: "HS256", typ: "JWT" });
    const claims = decode(payload ?? "");
    expect(claims).toMatchObject({
      orgId: "b3842fb3-91c5-4d9b-97a1-5d8816f993c0",
      token: { tag: "public", restrictions: { allowedOrigins: [ORIGIN], allowedAssistantIds: [ASSISTANT] } },
    });
    expect(Number(claims.exp) - Number(claims.iat)).toBe(30);
    const expected = createHmac("sha256", KEY).update(`${header}.${payload}`).digest("base64url");
    expect(signature).toBe(expected);

    expect((await server.inject(post("203.0.113.5"))).statusCode).toBe(200);
    expect((await server.inject(post("203.0.113.5"))).json()).toMatchObject({ callsLeft: 0 });
    const blocked = await server.inject(post("203.0.113.5"));
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers["retry-after"]).toBe(String(24 * 3600));
    expect(blocked.json()).toMatchObject({ error: "call_limit_reached", scope: "visitor" });
    expect(blocked.json().message).toContain("3 demo calls");

    expect((await server.inject(post("203.0.113.6"))).statusCode).toBe(200);
    await server.close();
  });

  test("rejects other origins and reports when calls are not configured", async () => {
    const server = await app();
    expect((await server.inject(post("203.0.113.5", "https://evil.example"))).statusCode).toBe(403);
    await server.close();

    const off = await app({ vapiApiKey: "" });
    const res = await off.inject(post("203.0.113.5"));
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: "web_calls_disabled" });
    await off.close();
  });

  test("falls back to the restricted public key, still behind the limit", async () => {
    const server = await app({ vapiApiKey: "", vapiPublicKey: "public-key-test" });
    const ok = await server.inject(post("203.0.113.8"));
    expect(ok.json()).toEqual({ token: "public-key-test", mode: "public-key", assistantId: ASSISTANT, callsLeft: 2 });
    await server.inject(post("203.0.113.8"));
    await server.inject(post("203.0.113.8"));
    const blocked = await server.inject(post("203.0.113.8"));
    expect(blocked.statusCode).toBe(429);
    expect(blocked.body).not.toContain("public-key-test");
    await server.close();
  });

  test("ignores forwarded headers unless the proxy is trusted", async () => {
    const server = await app({ trustProxyHeaders: false });
    for (let i = 0; i < 3; i += 1) expect((await server.inject(post(`198.51.100.${i}`))).statusCode).toBe(200);
    // Every request came from the same socket address, so spoofed headers do not reset the limit.
    expect((await server.inject(post("198.51.100.99"))).statusCode).toBe(429);
    await server.close();
  });
});
