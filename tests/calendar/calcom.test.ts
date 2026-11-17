import { describe, expect, test } from "vitest";
import { CalcomCalendar } from "../../src/calendar/calcom.js";

const NOW = new Date("2026-11-18T15:00:00.000Z");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Cal.com adapter", () => {
  test("filters remote slots through clinic hours and books with a synthetic email", async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, body: init?.body?.toString() });
      if (url.includes("/v2/slots")) {
        return jsonResponse({
          data: {
            "2026-11-19": [{ start: "2026-11-19T14:00:00.000Z" }, { start: "2026-11-19T02:00:00.000Z" }],
          },
        });
      }
      return jsonResponse({ data: { uid: "cal_1", start: "2026-11-19T14:00:00.000Z", end: "2026-11-19T14:30:00.000Z" } });
    };
    const calendar = new CalcomCalendar({
      apiKey: "cal_test",
      eventTypeId: "123",
      baseUrl: "https://api.cal.com/",
      now: () => NOW,
      fetchImpl,
    });
    const availability = await calendar.checkAvailability({ date: "2026-11-19" });
    expect(availability.dates[0]?.slots.map((slot) => slot.start)).toEqual(["2026-11-19T14:00:00Z"]);

    const booked = await calendar.book({
      start: "2026-11-19T14:00:00Z",
      patientName: "Maya Chen",
      phone: "312-555-0121",
      service: "cleaning",
    });
    expect(booked).toMatchObject({ ok: true, appointment: { id: "cal_1", phone: "+13125550121" } });
    const body = JSON.parse(calls[1]?.body ?? "{}") as { attendee: { email: string } };
    expect(body.attendee.email).toBe("13125550121@callers.brightside-dental.invalid");
  });

  test("does not call Cal.com for an after-hours time and maps conflicts", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return jsonResponse({}, 409);
    };
    const calendar = new CalcomCalendar({
      apiKey: "cal_test",
      eventTypeId: "abc",
      baseUrl: "https://api.cal.com",
      now: () => NOW,
      fetchImpl,
    });
    const outside = await calendar.book({
      start: "2026-11-22T15:00:00Z",
      patientName: "Maya Chen",
      phone: "+13125550121",
      service: "exam",
    });
    expect(outside).toMatchObject({ code: "closed" });
    expect(calls).toBe(0);

    const taken = await calendar.book({
      start: "2026-11-19T14:00:00Z",
      patientName: "Maya Chen",
      phone: "+13125550121",
      service: "exam",
    });
    expect(taken).toMatchObject({ code: "slot_taken" });
  });

  test("gets, reschedules, cancels, and lists bookings", async () => {
    const booking = {
      uid: "cal_9",
      start: "2026-11-23T15:00:00.000Z",
      end: "2026-11-23T15:30:00.000Z",
      status: "accepted",
      attendees: [{ name: "Andre Brooks", phoneNumber: "+13125550122" }],
      metadata: { service: "exam" },
    };
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (init?.method === "POST" && url.includes("/reschedule")) return jsonResponse({ data: booking });
      if (init?.method === "POST" && url.includes("/cancel")) return jsonResponse({ data: { ...booking, status: "cancelled" } });
      if (url.includes("/v2/bookings?")) return jsonResponse({ data: [booking] });
      return jsonResponse({ data: booking });
    };
    const calendar = new CalcomCalendar({
      apiKey: "cal_test",
      eventTypeId: "123",
      baseUrl: "https://api.cal.com",
      now: () => NOW,
      fetchImpl,
    });
    expect((await calendar.get("missing-but-200"))?.id).toBe("cal_9");
    const moved = await calendar.reschedule({ appointmentId: "cal_9", start: "2026-11-23T16:00:00Z" });
    expect(moved).toMatchObject({ ok: true, appointment: { startsAt: "2026-11-23T16:00:00Z" } });
    const cancelled = await calendar.cancel({ appointmentId: "cal_9", reason: "travel" });
    expect(cancelled).toMatchObject({ ok: true, appointment: { status: "cancelled" } });
    expect(await calendar.list()).toHaveLength(1);
  });

  test("returns not found and calendar errors", async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (init?.method === "POST") return jsonResponse({ error: "nope" }, 500);
      if (url.includes("missing")) return jsonResponse({}, 404);
      return jsonResponse({}, 500);
    };
    const calendar = new CalcomCalendar({
      apiKey: "cal_test",
      eventTypeId: "123",
      baseUrl: "https://api.cal.com",
      now: () => NOW,
      fetchImpl,
    });
    await expect(calendar.checkAvailability({ date: "2026-11-19" })).rejects.toThrow(/slots/);
    expect(await calendar.get("missing")).toBeNull();
    expect(await calendar.reschedule({ appointmentId: "missing", start: "2026-11-23T16:00:00Z" })).toMatchObject({
      code: "not_found",
    });
    const down = new CalcomCalendar({
      apiKey: "cal_test",
      eventTypeId: "123",
      baseUrl: "https://api.cal.com",
      now: () => NOW,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/cal_down")) {
          return jsonResponse({
            data: {
              uid: "cal_down",
              start: "2026-11-23T15:00:00.000Z",
              end: "2026-11-23T15:30:00.000Z",
              status: "accepted",
              attendees: [{ name: "A Person" }],
            },
          });
        }
        return jsonResponse({}, 500);
      },
    });
    expect(await down.reschedule({ appointmentId: "cal_down", start: "2026-11-23T16:00:00Z" })).toMatchObject({
      code: "calendar_unavailable",
    });
    expect(await down.cancel({ appointmentId: "cal_down" })).toMatchObject({ code: "calendar_unavailable" });
  });
});
