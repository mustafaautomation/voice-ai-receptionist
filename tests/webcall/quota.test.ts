import { describe, expect, test } from "vitest";
import { MemoryCallQuota, secondsToNextUtcDay, visitorDecision } from "../../src/webcall/quota.js";
import { RelayCallQuota } from "../../src/webcall/relay-quota.js";
import { fakeRelay, RELAY_TOKEN } from "../fake-relay.js";

const limits = { perVisitor: 3, perDay: 5 };
const T0 = new Date("2026-11-18T15:00:00.000Z");
const HOUR = 3600_000;

function relayQuota(relay: ReturnType<typeof fakeRelay>, perDay = 5) {
  return new RelayCallQuota({
    baseUrl: "https://relay.example.test",
    token: RELAY_TOKEN,
    namespace: "brightside",
    limits: { perVisitor: 3, perDay },
    fetchImpl: relay.fetchImpl,
  });
}

describe("visitor window", () => {
  test("allows three calls in a rolling 24 hours and says when the next opens", () => {
    const now = T0.getTime();
    expect(visitorDecision([now - 2 * HOUR, now - HOUR], limits, T0)).toEqual({ allowed: true, recent: 2 });
    const blocked = visitorDecision([now - 3 * HOUR, now - 2 * HOUR, now - HOUR], limits, T0);
    expect(blocked).toEqual({ allowed: false, retryAfterSeconds: 21 * 3600 });
    expect(visitorDecision([now - 25 * HOUR, now - 2 * HOUR, now - HOUR], limits, T0)).toMatchObject({ allowed: true });
    expect(secondsToNextUtcDay(T0)).toBe(9 * 3600);
  });
});

describe("memory quota", () => {
  test("blocks the fourth call per visitor and enforces the daily cap", async () => {
    const quota = new MemoryCallQuota(limits);
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await quota.acquire({ visitorKey: "a", now: T0 }));
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false]);
    expect(results[2]).toEqual({ ok: true, visitorRemaining: 0 });
    expect(results[3]).toMatchObject({ scope: "visitor" });
    expect((await quota.acquire({ visitorKey: "b", now: T0 })).ok).toBe(true);
    expect((await quota.acquire({ visitorKey: "c", now: T0 })).ok).toBe(true);
    expect(await quota.acquire({ visitorKey: "d", now: T0 })).toMatchObject({ ok: false, scope: "global" });
  });
});

describe("relay quota", () => {
  test("counts calls in the store, forwards the visitor IP, and blocks the fourth", async () => {
    let clock = T0.getTime();
    const relay = fakeRelay({ clock: () => (clock += 1000) });
    const quota = relayQuota(relay);
    const ip = "203.0.113.7";
    const outcomes = [];
    for (let i = 0; i < 4; i += 1) outcomes.push(await quota.acquire({ visitorKey: "v1", clientIp: ip, now: new Date(clock) }));
    expect(outcomes.map((o) => o.ok)).toEqual([true, true, true, false]);
    expect(outcomes[3]).toMatchObject({ ok: false, scope: "visitor" });
    const ids = [...relay.docs.values()].map((d) => d.id).sort();
    expect(ids.filter((id) => id.startsWith("voicecall-ip:"))).toHaveLength(3);
    expect(ids.filter((id) => id.startsWith("voicecall-day:"))).toHaveLength(3);
    expect(new Set(relay.clientIps)).toEqual(new Set([ip]));
    expect([...relay.docs.values()].every((d) => !JSON.stringify(d.data).includes(ip))).toBe(true);

    // A day later the same visitor can call again.
    clock += 24 * HOUR;
    expect((await quota.acquire({ visitorKey: "v1", clientIp: ip, now: new Date(clock) })).ok).toBe(true);
  });

  test("enforces the global daily cap across visitors", async () => {
    let clock = T0.getTime();
    const relay = fakeRelay({ clock: () => (clock += 1000) });
    const quota = relayQuota(relay, 2);
    expect((await quota.acquire({ visitorKey: "a", clientIp: "198.51.100.1", now: T0 })).ok).toBe(true);
    expect((await quota.acquire({ visitorKey: "b", clientIp: "198.51.100.2", now: T0 })).ok).toBe(true);
    expect(await quota.acquire({ visitorKey: "c", clientIp: "198.51.100.3", now: T0 })).toMatchObject({
      ok: false,
      scope: "global",
      retryAfterSeconds: 9 * 3600,
    });
  });

  test("two instances racing for the last visitor slot only let one through", async () => {
    let clock = T0.getTime();
    const relay = fakeRelay({ clock: () => (clock += 1000) });
    const quota = relayQuota(relay);
    const args = { visitorKey: "v", clientIp: "192.0.2.9", now: T0 };
    await quota.acquire(args);
    await quota.acquire(args);
    const raced = await Promise.all([quota.acquire(args), quota.acquire(args)]);
    expect(raced.filter((r) => r.ok)).toHaveLength(1);
    expect([...relay.docs.values()].filter((d) => d.id.startsWith("voicecall-ip:"))).toHaveLength(3);
    // The loser released its global slot.
    expect([...relay.docs.values()].filter((d) => d.id.startsWith("voicecall-day:"))).toHaveLength(3);
  });

  test("fails closed when the store is unreachable", async () => {
    const quota = relayQuota(fakeRelay({ down: true }));
    expect(await quota.acquire({ visitorKey: "v", clientIp: "192.0.2.1", now: T0 })).toEqual({
      ok: false,
      scope: "unavailable",
      retryAfterSeconds: 60,
    });
  });
});
