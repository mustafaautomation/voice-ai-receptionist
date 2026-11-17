import { describe, expect, test } from "vitest";
import { toGhlContactPayload, GhlStubCrm } from "../../src/crm/ghl-stub.js";
import { MemoryCrm } from "../../src/crm/memory.js";
import { WebhookCrm } from "../../src/crm/webhook.js";
import type { Lead } from "../../src/crm/types.js";

const lead: Lead = {
  callId: "vapi_1",
  name: "Maya Chen",
  phone: "+13125550121",
  summary: "Booked a cleaning.",
  outcome: "booked",
  appointmentId: "apt_1",
  interest: "cleaning",
};

describe("CRM adapters", () => {
  test("memory adapter records the lead", async () => {
    const crm = new MemoryCrm();
    const result = await crm.pushLead(lead);
    expect(result).toMatchObject({ ok: true, provider: "memory" });
    expect(crm.pushed).toEqual([lead]);
  });

  test("webhook adapter posts the lead and reports failures", async () => {
    const seen: Array<{ url: string; headers: Headers; body: string }> = [];
    const ok = new WebhookCrm("https://crm.example.test/hooks/lead", "hook-secret", async (input, init) => {
      seen.push({ url: String(input), headers: new Headers(init?.headers), body: String(init?.body) });
      return new Response("ok", { status: 202, headers: { "x-request-id": "req_1" } });
    });
    expect(await ok.pushLead(lead)).toMatchObject({ ok: true, externalId: "req_1" });
    expect(seen[0]?.headers.get("x-webhook-secret")).toBe("hook-secret");
    expect(JSON.parse(seen[0]?.body ?? "{}")).toMatchObject({ event: "call.completed", lead });

    const down = new WebhookCrm("https://crm.example.test/hooks/lead", undefined, async () => new Response("no", { status: 500 }));
    expect(await down.pushLead(lead)).toMatchObject({ ok: false, provider: "webhook" });

    const boom = new WebhookCrm("https://crm.example.test/hooks/lead", undefined, async () => {
      throw new Error("network down");
    });
    expect(await boom.pushLead(lead)).toMatchObject({ ok: false, error: "network down" });
  });

  test("GHL stub shapes a contact and does not call the network", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error("stub must not use the network");
    };
    try {
      const stub = new GhlStubCrm();
      const result = await stub.pushLead(lead);
      expect(result.stub).toBe(true);
      expect(result.externalId?.startsWith("ghl_stub_")).toBe(true);
      expect(toGhlContactPayload(lead)).toMatchObject({
        firstName: "Maya",
        lastName: "Chen",
        phone: "+13125550121",
        source: "AI Receptionist",
      });
      const single = toGhlContactPayload({ ...lead, name: "Madonna", appointmentId: undefined });
      expect(single).toMatchObject({ firstName: "Madonna", lastName: "Unknown" });
      const fields = single.customFields as Array<{ key: string }>;
      expect(fields.some((field) => field.key === "appointment_id")).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });
});
