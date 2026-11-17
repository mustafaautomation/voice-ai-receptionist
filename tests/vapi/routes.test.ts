import { describe, expect, test } from "vitest";
import { buildApp } from "../../src/app.js";
import type { CrmAdapter, CrmPushResult, Lead } from "../../src/crm/types.js";
import { verifyVapiSecret } from "../../src/vapi/auth.js";
import { memoryDb, NOW, SECRET, testConfig } from "../helpers.js";

class CountingCrm implements CrmAdapter {
  readonly name = "memory" as const;
  pushes: Lead[] = [];
  failuresLeft: number;
  constructor(failuresLeft = 0) {
    this.failuresLeft = failuresLeft;
  }
  pushLead(lead: Lead): Promise<CrmPushResult> {
    this.pushes.push(lead);
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1;
      return Promise.resolve({ ok: false, provider: "memory", error: "down" });
    }
    return Promise.resolve({ ok: true, provider: "memory", externalId: `mem_${lead.callId}` });
  }
}

async function appWith(crm = new CountingCrm()) {
  const db = memoryDb();
  const app = await buildApp({ config: testConfig(), db, crm, now: () => NOW });
  return { app, db, crm };
}

function post(url: string, payload: object, secret: string | null = SECRET) {
  return {
    method: "POST" as const,
    url,
    headers: {
      "content-type": "application/json",
      ...(secret ? { "x-vapi-secret": secret } : {}),
    },
    payload,
  };
}

describe("vapi auth", () => {
  test("compares the shared secret", () => {
    expect(verifyVapiSecret(SECRET, SECRET)).toBe(true);
    expect(verifyVapiSecret("wrong-secret-value", SECRET)).toBe(false);
    expect(verifyVapiSecret("short", SECRET)).toBe(false);
    expect(verifyVapiSecret(undefined, SECRET)).toBe(false);
    expect(verifyVapiSecret([SECRET], SECRET)).toBe(true);
  });
});

describe("vapi routes", () => {
  test("rejects a bad secret and a malformed envelope", async () => {
    const { app } = await appWith();
    const denied = await app.inject(post("/vapi/webhook", { message: { type: "tool-calls" } }, "nope-nope-nope"));
    expect(denied.statusCode).toBe(401);
    const missing = await app.inject(post("/vapi/webhook", { message: { type: "tool-calls" } }, null));
    expect(missing.statusCode).toBe(401);
    const bad = await app.inject(post("/vapi/webhook", { nope: true }));
    expect(bad.statusCode).toBe(400);
    const ignored = await app.inject(post("/vapi/webhook", { message: { type: "status-update", call: { id: "c1" } } }));
    expect(ignored.statusCode).toBe(200);
    expect(ignored.json()).toMatchObject({ ignored: "status-update" });
    await app.close();
  });

  test("books through the tool URL, is idempotent, and blocks a second booking of that slot", async () => {
    const { app, db } = await appWith();
    const args = {
      start: "2026-11-19T14:00:00Z",
      patientName: "Maya Chen",
      phone: "312-555-0121",
      service: "cleaning",
    };
    const body = {
      message: {
        type: "tool-calls",
        call: { id: "call_book", customer: { number: "+13125550121" } },
        toolCallList: [
          { id: "tc_1", function: { name: "book_appointment", arguments: JSON.stringify(args) } },
        ],
      },
    };
    const first = await app.inject(post("/vapi/tools/book_appointment", body));
    expect(first.statusCode).toBe(200);
    expect(first.json().results[0].result.ok).toBe(true);
    const second = await app.inject(post("/vapi/tools/book_appointment", body));
    expect(second.json()).toEqual(first.json());
    const rows = db.prepare("SELECT id FROM appointments WHERE status = 'booked'").all();
    expect(rows).toHaveLength(1);

    const clash = await app.inject(
      post("/vapi/tools/book_appointment", {
        message: {
          type: "tool-calls",
          call: { id: "call_other" },
          toolCallList: [{ id: "tc_2", function: { name: "book_appointment", arguments: args } }],
        },
      }),
    );
    expect(clash.json().results[0].result).toMatchObject({ ok: false, code: "slot_taken" });

    const mismatch = await app.inject(
      post("/vapi/tools/check_availability", {
        message: {
          type: "tool-calls",
          call: { id: "call_book" },
          toolCallList: [{ id: "tc_3", function: { name: "book_appointment", arguments: {} } }],
        },
      }),
    );
    expect(mismatch.json().results[0].result.code).toBe("tool_mismatch");

    const direct = await app.inject(
      post("/vapi/tools/check_availability", {
        callId: "call_direct",
        toolCallId: "tc_direct",
        arguments: { date: "2026-11-19" },
      }),
    );
    expect(direct.json().result.ok).toBe(true);
    expect(direct.json().result.dates[0].slots.length).toBeGreaterThan(0);

    const invalidArgs = await app.inject(
      post("/vapi/tools/book_appointment", {
        callId: "call_bad_args",
        toolCallId: "tc_bad",
        arguments: { start: "2026-11-19T15:00:00Z" },
      }),
    );
    expect(invalidArgs.json().result).toMatchObject({ ok: false, code: "invalid_arguments" });
    expect(await app.inject(post("/vapi/tools/not_a_tool", { callId: "x" })).then((res) => res.statusCode)).toBe(404);
    await app.close();
  });

  test("end-of-call stores the transcript once and retries a failed CRM push", async () => {
    const crm = new CountingCrm(1);
    const { app } = await appWith(crm);
    await app.inject(
      post("/vapi/webhook", {
        message: {
          type: "tool-calls",
          call: { id: "call_end" },
          toolCallList: [
            {
              id: "tc_book",
              function: {
                name: "book_appointment",
                arguments: {
                  start: "2026-11-19T16:00:00Z",
                  patientName: "Maya Chen",
                  phone: "+13125550121",
                  service: "cleaning",
                },
              },
            },
          ],
        },
      }),
    );
    const report = {
      message: {
        type: "end-of-call-report",
        endedReason: "customer-ended-call",
        call: { id: "call_end", customer: { number: "+13125550121" } },
        summary: "Caller booked a cleaning.",
        artifact: {
          transcript: "user: I need a cleaning.\nassistant: You are booked.",
        },
        analysis: { summary: "Booked a cleaning.", structuredData: { intent: "booking" } },
      },
    };
    const failed = await app.inject(post("/vapi/webhook", report));
    expect(failed.statusCode).toBe(502);
    const saved = await app.inject(post("/vapi/webhook", report));
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ ok: true, outcome: "booked", crmStatus: "pushed" });
    const replay = await app.inject(post("/vapi/webhook", report));
    expect(replay.json()).toEqual(saved.json());
    expect(crm.pushes).toHaveLength(2);

    const detail = await app.inject({ method: "GET", url: `/api/calls/${saved.json().callId}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().call.transcript).toContain("I need a cleaning");
    expect(detail.json().lead.name).toBe("Maya Chen");
    await app.close();
  });

  test("a call with no tools can be tagged as a wrong number from structured data", async () => {
    const { app } = await appWith();
    const response = await app.inject(
      post("/vapi/webhook", {
        message: {
          type: "end-of-call-report",
          call: { id: "call_wrong" },
          artifact: { messages: [{ role: "user", message: "Wrong number." }] },
          analysis: { summary: "Wrong number.", structuredData: { intent: "wrong_number" } },
        },
      }),
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().outcome).toBe("wrong_number");
    const missingCall = await app.inject(
      post("/vapi/webhook", { message: { type: "end-of-call-report" } }),
    );
    expect(missingCall.statusCode).toBe(400);
    const missingTools = await app.inject(
      post("/vapi/webhook", { message: { type: "tool-calls", call: { id: "call_empty" }, toolCallList: [] } }),
    );
    expect(missingTools.statusCode).toBe(400);
    await app.close();
  });

  test("transfer marks the call and bad tool JSON is a tool error", async () => {
    const { app } = await appWith();
    const response = await app.inject(
      post("/vapi/webhook", {
        message: {
          type: "tool-calls",
          call: { id: "call_transfer" },
          toolCalls: [
            { id: "tc_bad_json", function: { name: "transfer_to_human", arguments: "not-json" } },
            { id: "tc_transfer", name: "transfer_to_human", parameters: { reason: "Caller asked for a person." } },
          ],
        },
      }),
    );
    const results = response.json().results;
    expect(results[0].result.code).toBe("invalid_arguments");
    expect(results[1].result).toMatchObject({ ok: true, transfer: true, destination: "+13125550199" });
    await app.close();
  });
});
