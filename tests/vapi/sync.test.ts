import { describe, expect, test } from "vitest";
import { buildAssistant, SYSTEM_PROMPT } from "../../src/vapi/assistant.js";
import { syncAssistant } from "../../src/vapi/sync.js";
import { parseConfig } from "../../src/config.js";

describe("assistant sync", () => {
  test("dry-run does not call the network", async () => {
    const result = await syncAssistant({
      publicBaseUrl: "https://demo.example.test",
      serverUrlSecret: "local-secret",
      fetchImpl: () => {
        throw new Error("dry run must not call Vapi");
      },
    });
    expect(result.mode).toBe("dry-run");
    expect(result.payload.serverUrl).toBe("https://demo.example.test/vapi/webhook");
    expect(result.payload.model.tools.map((tool) => tool.function.name)).toEqual([
      "check_availability",
      "book_appointment",
      "reschedule_appointment",
      "cancel_appointment",
      "transfer_to_human",
    ]);
    expect(SYSTEM_PROMPT).toContain("Brightside Dental");
    expect(buildAssistant({ publicBaseUrl: "https://demo.example.test" }).serverUrlSecret).toBeUndefined();
  });

  test("updates an assistant with the same name and creates one otherwise", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (!init?.method) return new Response(JSON.stringify([{ id: "asst_1", name: "Brightside Dental Receptionist" }]));
      if (init.method === "PATCH") return new Response(JSON.stringify({ id: "asst_1" }));
      return new Response(JSON.stringify({ id: "asst_new" }), { status: 201 });
    };
    const updated = await syncAssistant({
      apiKey: "test-key",
      publicBaseUrl: "https://demo.example.test",
      fetchImpl,
    });
    expect(updated).toMatchObject({ mode: "updated", assistantId: "asst_1" });

    const created = await syncAssistant({
      apiKey: "test-key",
      publicBaseUrl: "https://demo.example.test",
      fetchImpl: async (_input, init) => {
        if (!init?.method) return new Response(JSON.stringify({ assistants: [] }));
        return new Response(JSON.stringify({ id: "asst_new" }), { status: 201 });
      },
    });
    expect(created).toMatchObject({ mode: "created", assistantId: "asst_new" });
    expect(calls[0]).toContain("api.vapi.ai/assistant");
  });

  test("config requires a webhook secret and gated providers", () => {
    expect(() => parseConfig({})).toThrow(/VAPI_WEBHOOK_SECRET/);
    expect(parseConfig({ VAPI_WEBHOOK_SECRET: "local-secret" }).calendarProvider).toBe("sqlite");
    expect(() => parseConfig({ VAPI_WEBHOOK_SECRET: "local-secret", CALENDAR_PROVIDER: "calcom" })).toThrow(/CALCOM_API_KEY/);
    expect(() => parseConfig({ VAPI_WEBHOOK_SECRET: "local-secret", CRM_PROVIDER: "webhook" })).toThrow(/CRM_WEBHOOK_URL/);
  });
});
