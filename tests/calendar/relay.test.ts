import { describe, expect, test } from "vitest";
import { RelayCalendar } from "../../src/calendar/relay.js";
import { executeTool } from "../../src/vapi/dispatch.js";
import { fakeRelay, RELAY_TOKEN } from "../fake-relay.js";

const NOW = new Date("2026-11-18T15:00:00.000Z");
const TOKEN = RELAY_TOKEN;

function calendar(relay: ReturnType<typeof fakeRelay>, namespace = "brightside") {
  return new RelayCalendar({
    baseUrl: "https://relay.example.test/",
    token: TOKEN,
    namespace,
    now: () => NOW,
    fetchImpl: relay.fetchImpl,
  });
}

const booking = {
  start: "2026-11-20T15:00:00Z",
  patientName: "Maya Chen",
  phone: "312-555-0121",
  service: "cleaning" as const,
};

describe("relay calendar", () => {
  test("books through the atomic reserve call and hides the slot afterwards", async () => {
    const relay = fakeRelay();
    const cal = calendar(relay);
    const booked = await cal.book(booking);
    expect(booked.ok).toBe(true);
    expect(relay.requests).toContain(`POST /v1/store/appointments/brightside:${booked.ok ? booked.appointment.id : ""}/reserve`);
    const stored = [...relay.docs.values()][0];
    expect(stored?.data).toMatchObject({ app: "brightside", slot_key: "brightside|2026-11-20T15:00:00Z", status: "booked" });

    const availability = await cal.checkAvailability({ date: "2026-11-20" });
    const starts = availability.dates[0]?.slots.map((slot) => slot.start) ?? [];
    expect(starts).not.toContain("2026-11-20T15:00:00Z");
    expect(starts.length).toBeGreaterThan(0);
    expect(await cal.list()).toHaveLength(1);
  });

  test("a second instance with a stale snapshot still cannot double book", async () => {
    const relay = fakeRelay();
    const first = calendar(relay);
    const second = calendar(relay);
    const realFetch = relay.fetchImpl;
    let staleList = true;
    // The second instance reads an empty list (as if it loaded before the first booking committed).
    const staleSecond = new RelayCalendar({
      baseUrl: "https://relay.example.test",
      token: TOKEN,
      namespace: "brightside",
      now: () => NOW,
      fetchImpl: async (input, init) => {
        if (staleList && (init?.method ?? "GET") === "GET") {
          staleList = false;
          return Response.json({ items: [], next_cursor: null });
        }
        return realFetch(input, init);
      },
    });
    expect((await first.book(booking)).ok).toBe(true);
    const clash = await staleSecond.book({ ...booking, patientName: "Andre Brooks", phone: "312-555-0122" });
    expect(clash).toMatchObject({ ok: false, code: "slot_taken" });
    expect(await second.list({ status: "booked" })).toHaveLength(1);
  });

  test("reschedule moves the slot and cancel frees it", async () => {
    const relay = fakeRelay();
    const cal = calendar(relay);
    const booked = await cal.book(booking);
    if (!booked.ok) throw new Error(booked.message);
    const moved = await cal.reschedule({ appointmentId: booked.appointment.id, start: "2026-11-20T16:00:00Z" });
    expect(moved).toMatchObject({ ok: true, appointment: { startsAt: "2026-11-20T16:00:00Z" } });
    expect((await cal.book({ ...booking, patientName: "Andre Brooks" })).ok).toBe(true);

    const cancelled = await cal.cancel({ appointmentId: booked.appointment.id, reason: "travel" });
    expect(cancelled).toMatchObject({ ok: true, appointment: { status: "cancelled" } });
    const again = await cal.book({ ...booking, start: "2026-11-20T16:00:00Z", patientName: "Priya Shah" });
    expect(again.ok).toBe(true);
    expect(await cal.get(booked.appointment.id)).toMatchObject({ status: "cancelled" });
  });

  test("ignores rows written by other apps on the same store", async () => {
    const relay = fakeRelay();
    expect((await calendar(relay, "other-demo").book(booking)).ok).toBe(true);
    const cal = calendar(relay);
    expect(await cal.list()).toEqual([]);
    expect((await cal.book(booking)).ok).toBe(true);
  });

  test("returns a spoken fallback when the store is unreachable", async () => {
    const cal = calendar(fakeRelay({ down: true }));
    expect(await cal.book(booking)).toMatchObject({ ok: false, code: "calendar_unavailable" });
    await expect(cal.checkAvailability({})).rejects.toThrow();
    const spoken = await executeTool("check_availability", {}, { calendar: cal, transferNumber: "+13125550199", now: NOW });
    expect(spoken).toMatchObject({ ok: false, code: "tool_error" });
  });
});
