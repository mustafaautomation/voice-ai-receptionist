import { randomUUID } from "node:crypto";
import {
  secondsToNextUtcDay,
  utcDay,
  visitorDecision,
  type CallQuota,
  type QuotaLimits,
  type QuotaResult,
} from "./quota.js";

type FetchLike = typeof fetch;
type Doc = { id: string; data: Record<string, unknown>; created_at: number };

class StoreError extends Error {}

const UNAVAILABLE: QuotaResult = { ok: false, scope: "unavailable", retryAfterSeconds: 60 };

/**
 * Call counters in the D1 document store (`events` collection).
 *
 * Every counted call is one numbered doc per scope, written with the store's atomic
 * reserve on a unique slot_key. Doc ids carry a random suffix, because the store lets
 * the same id re-reserve its own slot. Two requests that read the same count race for the
 * same number; one gets 409, re-reads, and is checked against the limit again.
 * So the limits hold across serverless instances. Any store error fails closed.
 */
export class RelayCallQuota implements CallQuota {
  readonly kind = "relay" as const;
  private readonly base: string;
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly options: {
      baseUrl: string;
      token: string;
      namespace: string;
      limits: QuotaLimits;
      fetchImpl?: FetchLike;
    },
  ) {
    this.base = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async acquire(input: { visitorKey: string; clientIp: string; now: Date }): Promise<QuotaResult> {
    try {
      return await this.run(input);
    } catch (error) {
      if (error instanceof StoreError) return UNAVAILABLE;
      throw error;
    }
  }

  private async run(input: { visitorKey: string; clientIp: string; now: Date }): Promise<QuotaResult> {
    const { limits, namespace } = this.options;
    const ip = input.clientIp;
    const visitorField = `${namespace}|${input.visitorKey}`;

    let visitorDocs = await this.list("voice_ip", visitorField, ip);
    const first = visitorDecision(visitorDocs.map((d) => d.created_at), limits, input.now);
    if (!first.allowed) return { ok: false, scope: "visitor", retryAfterSeconds: first.retryAfterSeconds };

    // Global daily cap.
    const day = utcDay(input.now);
    const dayField = `${namespace}|${day}`;
    let dayId: string | null = null;
    for (let attempt = 0; attempt < 5 && !dayId; attempt += 1) {
      const dayDocs = await this.list("voice_day", dayField, ip);
      if (dayDocs.length >= limits.perDay) {
        return { ok: false, scope: "global", retryAfterSeconds: secondsToNextUtcDay(input.now) };
      }
      const n = nextNumber(dayDocs);
      const id = `voicecall-day:${namespace}:${day}:${n}:${randomUUID().slice(0, 8)}`;
      const status = await this.reserve(id, { voice_day: dayField, n, slot_key: `voice-day|${dayField}|${n}` }, ip);
      if (status === "ok") dayId = id;
    }
    if (!dayId) return UNAVAILABLE;

    // Per-visitor slot, re-checked after any lost race.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const decision = visitorDecision(visitorDocs.map((d) => d.created_at), limits, input.now);
      if (!decision.allowed) {
        await this.release(dayId, ip);
        return { ok: false, scope: "visitor", retryAfterSeconds: decision.retryAfterSeconds };
      }
      const n = nextNumber(visitorDocs);
      const id = `voicecall-ip:${namespace}:${input.visitorKey}:${n}:${randomUUID().slice(0, 8)}`;
      const status = await this.reserve(id, { voice_ip: visitorField, n, slot_key: `voice-ip|${visitorField}|${n}` }, ip);
      if (status === "ok") return { ok: true, visitorRemaining: limits.perVisitor - decision.recent - 1 };
      visitorDocs = await this.list("voice_ip", visitorField, ip);
    }
    await this.release(dayId, ip);
    return UNAVAILABLE;
  }

  private async list(key: string, value: string, ip: string): Promise<Doc[]> {
    const params = new URLSearchParams({ filter_key: key, filter_value: value, limit: "200" });
    const response = await this.request(`/v1/store/events?${params.toString()}`, "GET", ip);
    if (!response.ok) throw new StoreError(`list failed (${response.status})`);
    const body = (await response.json()) as { items?: Doc[] };
    return body.items ?? [];
  }

  private async reserve(id: string, data: Record<string, unknown>, ip: string): Promise<"ok" | "taken"> {
    const response = await this.request(
      `/v1/store/events/${encodeURIComponent(id)}/reserve`,
      "POST",
      ip,
      JSON.stringify({ ...data, app: this.options.namespace, status: "counted" }),
    );
    if (response.status === 409) return "taken";
    if (response.status !== 201 && response.status !== 200) throw new StoreError(`reserve failed (${response.status})`);
    return "ok";
  }

  private async release(id: string, ip: string): Promise<void> {
    await this.request(`/v1/store/events/${encodeURIComponent(id)}`, "DELETE", ip).catch(() => undefined);
  }

  private async request(path: string, method: string, ip: string, body?: string): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.options.token}`,
          // The store rate-limits per visitor when this header is present.
          "x-client-ip": ip,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body,
        signal: AbortSignal.timeout(8000),
      });
    } catch (error) {
      throw new StoreError(error instanceof Error ? error.message : "network error");
    }
  }
}

function nextNumber(docs: Doc[]): number {
  let max = 0;
  for (const doc of docs) {
    const n = Number(doc.data.n);
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max + 1;
}
