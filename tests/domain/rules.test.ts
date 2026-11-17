import { describe, expect, test } from "vitest";
import { MemoryAppointmentStore } from "../../src/calendar/memory.js";
import { bookInStore, cancelInStore, checkAvailability, rescheduleInStore } from "../../src/domain/scheduling.js";
import { normalizePhone } from "../../src/domain/phone.js";
import { evaluateSlot, slotsForDate } from "../../src/domain/rules.js";
import type { Appointment } from "../../src/domain/types.js";

const NOW = new Date("2026-11-18T15:00:00.000Z");

function seed(partial: Partial<Appointment> & Pick<Appointment, "id" | "startsAt" | "endsAt">): Appointment {
  return {
    patientName: "Existing Patient",
    phone: "+13125550100",
    service: "cleaning",
    status: "booked",
    notes: "",
    createdAt: "2026-11-01T15:00:00Z",
    updatedAt: "2026-11-01T15:00:00Z",
    ...partial,
  };
}

describe("phone numbers", () => {
  test("accepts E.164 and US local numbers", () => {
    expect(normalizePhone("+13125550121")).toBe("+13125550121");
    expect(normalizePhone("(312) 555-0121")).toBe("+13125550121");
    expect(normalizePhone("13125550121")).toBe("+13125550121");
    expect(normalizePhone("555-0121")).toBeNull();
    expect(normalizePhone("not a phone")).toBeNull();
  });
});

describe("slot rules", () => {
  test("lists a full weekday grid and hides past slots today", () => {
    const thursday = slotsForDate("2026-11-19", NOW, new Set());
    expect(thursday.closed).toBe(false);
    expect(thursday.slots).toHaveLength(18);
    expect(thursday.slots[0]?.start).toBe("2026-11-19T14:00:00Z");
    expect(thursday.slots.at(-1)?.start).toBe("2026-11-19T22:30:00Z");

    const today = slotsForDate("2026-11-18", NOW, new Set());
    expect(today.slots).toHaveLength(15);
    expect(today.slots[0]?.start).toBe("2026-11-18T15:30:00Z");
  });

  test("saturday is a short day and sunday is closed", () => {
    const saturday = slotsForDate("2026-11-21", NOW, new Set());
    expect(saturday.slots).toHaveLength(8);
    expect(saturday.slots[0]?.start).toBe("2026-11-21T15:00:00Z");
    expect(saturday.slots.at(-1)?.start).toBe("2026-11-21T18:30:00Z");
    expect(slotsForDate("2026-11-22", NOW, new Set()).closed).toBe(true);
    expect(slotsForDate("nope", NOW, new Set()).closed).toBe(true);
  });

  test("rejects past, closed, after hours, misaligned, taken, and far-away times", () => {
    const booked = new Set(["2026-11-19T14:00:00Z"]);
    expect(evaluateSlot("2026-11-18T14:00:00Z", NOW, booked).ok).toBe(false);
    expect(evaluateSlot("2026-11-22T15:00:00Z", NOW, booked)).toMatchObject({ code: "closed" });
    expect(evaluateSlot("2026-11-21T19:00:00Z", NOW, booked)).toMatchObject({ code: "outside_hours" });
    expect(evaluateSlot("2026-11-19T14:15:00Z", NOW, booked)).toMatchObject({ code: "misaligned_slot" });
    expect(evaluateSlot("2026-11-19T14:00:00Z", NOW, booked)).toMatchObject({ code: "slot_taken" });
    expect(evaluateSlot("not-a-date", NOW, booked)).toMatchObject({ code: "invalid_time" });
    expect(evaluateSlot("2027-03-01T15:00:00Z", NOW, booked)).toMatchObject({ code: "too_far" });
    expect(evaluateSlot("2026-11-19T14:00:00-06:00", NOW, new Set())).toMatchObject({
      ok: true,
      start: "2026-11-19T20:00:00Z",
    });
  });
});

describe("scheduling", () => {
  test("books, blocks a double book, reschedules, and cancels", () => {
    const store = new MemoryAppointmentStore();
    const booked = bookInStore(
      store,
      { start: "2026-11-19T16:00:00Z", patientName: "Maya Chen", phone: "(312) 555-0121", service: "cleaning" },
      NOW,
    );
    expect(booked.ok).toBe(true);
    if (!booked.ok) return;
    expect(booked.appointment.phone).toBe("+13125550121");

    const clash = bookInStore(
      store,
      { start: "2026-11-19T16:00:00Z", patientName: "Other Person", phone: "+13125550199", service: "exam" },
      NOW,
    );
    expect(clash).toMatchObject({ ok: false, code: "slot_taken" });

    const moved = rescheduleInStore(store, { appointmentId: booked.appointment.id, start: "2026-11-19T17:00:00Z" }, NOW);
    expect(moved).toMatchObject({ ok: true, appointment: { startsAt: "2026-11-19T17:00:00Z" } });

    const freed = bookInStore(
      store,
      { start: "2026-11-19T16:00:00Z", patientName: "Other Person", phone: "+13125550199", service: "exam" },
      NOW,
    );
    expect(freed.ok).toBe(true);

    const cancelled = cancelInStore(store, { appointmentId: booked.appointment.id, reason: "travel" }, NOW);
    expect(cancelled).toMatchObject({ ok: true, appointment: { status: "cancelled" } });
    expect(store.list({ status: "booked" })).toHaveLength(1);
  });

  test("enforces the 24 hour change window and validates identity fields", () => {
    const soon = seed({
      id: "apt_soon",
      startsAt: "2026-11-18T17:00:00Z",
      endsAt: "2026-11-18T17:30:00Z",
    });
    const store = new MemoryAppointmentStore([soon]);
    expect(cancelInStore(store, { appointmentId: "apt_soon" }, NOW)).toMatchObject({
      code: "inside_cancellation_window",
    });
    expect(rescheduleInStore(store, { appointmentId: "apt_soon", start: "2026-11-20T15:00:00Z" }, NOW)).toMatchObject({
      code: "inside_cancellation_window",
    });
    expect(cancelInStore(store, { appointmentId: "missing" }, NOW)).toMatchObject({ code: "not_found" });

    const edge = bookInStore(
      new MemoryAppointmentStore(),
      { start: "2026-11-19T15:00:00Z", patientName: "Edge Case", phone: "+13125550121", service: "exam" },
      NOW,
    );
    expect(edge.ok).toBe(true);
    if (!edge.ok) return;
    const dayLater = new Date("2026-11-18T15:00:00.000Z");
    expect(cancelInStore(new MemoryAppointmentStore([edge.appointment]), { appointmentId: edge.appointment.id }, dayLater).ok).toBe(
      true,
    );
    const allowedNow = new Date("2026-11-18T15:00:00.000Z");
    const far = seed({ id: "apt_far", startsAt: "2026-11-19T15:00:00Z", endsAt: "2026-11-19T15:30:00Z" });
    expect(cancelInStore(new MemoryAppointmentStore([far]), { appointmentId: "apt_far" }, allowedNow).ok).toBe(true);

    const empty = new MemoryAppointmentStore();
    expect(bookInStore(empty, { start: "2026-11-19T15:00:00Z", patientName: "A", phone: "+13125550121", service: "exam" }, NOW)).toMatchObject({
      code: "invalid_name",
    });
    expect(
      bookInStore(empty, { start: "2026-11-19T15:00:00Z", patientName: "Maya Chen", phone: "123", service: "exam" }, NOW),
    ).toMatchObject({ code: "invalid_phone" });
    expect(
      bookInStore(empty, {
        start: "2026-11-19T15:00:00Z",
        patientName: "Maya Chen",
        phone: "+13125550121",
        service: "root-canal" as "exam",
      }, NOW),
    ).toMatchObject({ code: "invalid_service" });
  });

  test("availability reports after-hours and skips booked slots", () => {
    const store = new MemoryAppointmentStore([
      seed({ id: "apt_taken", startsAt: "2026-11-19T14:00:00Z", endsAt: "2026-11-19T14:30:00Z" }),
    ]);
    const daytime = checkAvailability(store, { date: "2026-11-19" }, NOW);
    expect(daytime.afterHours).toBe(false);
    expect(daytime.dates[0]?.slots.some((slot) => slot.start === "2026-11-19T14:00:00Z")).toBe(false);
    expect(daytime.dates[0]?.slots).toHaveLength(17);

    const evening = checkAvailability(store, { date: "2026-11-20" }, new Date("2026-11-21T02:00:00.000Z"));
    expect(evening.afterHours).toBe(true);
    expect(evening.dates[0]?.slots).toHaveLength(0);
    expect(evening.dates[0]?.closed).toBe(false);
  });

  test("does not change a cancelled appointment or a slot in the past", () => {
    const cancelled = seed({
      id: "apt_old",
      startsAt: "2026-11-24T15:00:00Z",
      endsAt: "2026-11-24T15:30:00Z",
      status: "cancelled",
    });
    expect(cancelInStore(new MemoryAppointmentStore([cancelled]), { appointmentId: "apt_old" }, NOW)).toMatchObject({
      code: "already_cancelled",
    });
    const past = seed({ id: "apt_past", startsAt: "2026-11-17T15:00:00Z", endsAt: "2026-11-17T15:30:00Z" });
    expect(cancelInStore(new MemoryAppointmentStore([past]), { appointmentId: "apt_past" }, NOW)).toMatchObject({
      code: "in_the_past",
    });
  });
});
