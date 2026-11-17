import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { SqliteCalendar } from "../../src/calendar/sqlite-calendar.js";
import { SqliteAppointmentStore } from "../../src/calendar/sqlite.js";
import { DuplicateSlotError } from "../../src/calendar/store.js";
import { openDatabase } from "../../src/db/database.js";
import type { Appointment } from "../../src/domain/types.js";

const NOW = new Date("2026-11-18T15:00:00.000Z");

function row(id: string, startsAt: string): Appointment {
  return {
    id,
    patientName: "Existing Patient",
    phone: "+13125550100",
    service: "cleaning",
    startsAt,
    endsAt: "2026-11-19T14:30:00Z",
    status: "booked",
    notes: "",
    createdAt: "2026-11-01T15:00:00Z",
    updatedAt: "2026-11-01T15:00:00Z",
  };
}

describe("sqlite calendar", () => {
  test("the unique index rejects a second booked row and allows the slot after cancel", async () => {
    const db = openDatabase(":memory:");
    const store = new SqliteAppointmentStore(db);
    store.insert(row("apt_a", "2026-11-19T14:00:00Z"));
    expect(() => store.insert(row("apt_b", "2026-11-19T14:00:00Z"))).toThrow(DuplicateSlotError);

    const calendar = new SqliteCalendar(store, () => NOW);
    const booked = await calendar.book({
      start: "2026-11-19T15:00:00Z",
      patientName: "Maya Chen",
      phone: "+13125550121",
      service: "cleaning",
    });
    expect(booked.ok).toBe(true);
    if (!booked.ok) return;
    const again = await calendar.book({
      start: "2026-11-19T15:00:00Z",
      patientName: "Other Person",
      phone: "+13125550999",
      service: "exam",
    });
    expect(again).toMatchObject({ ok: false, code: "slot_taken" });

    const cancelled = await calendar.cancel({ appointmentId: booked.appointment.id, reason: "plans changed" });
    expect(cancelled.ok).toBe(true);
    const reused = await calendar.book({
      start: "2026-11-19T15:00:00Z",
      patientName: "Other Person",
      phone: "+13125550999",
      service: "exam",
    });
    expect(reused.ok).toBe(true);
    expect(await calendar.list({ status: "booked" })).toHaveLength(2);
  });

  test("two connections cannot both keep the same booked start", () => {
    const dir = mkdtempSync(join(tmpdir(), "brightside-"));
    const path = join(dir, "clinic.sqlite");
    const first = openDatabase(path);
    const second = openDatabase(path);
    const a = new SqliteAppointmentStore(first);
    const b = new SqliteAppointmentStore(second);
    a.insert(row("apt_a", "2026-11-19T16:00:00Z"));
    expect(() => b.insert(row("apt_b", "2026-11-19T16:00:00Z"))).toThrow(DuplicateSlotError);
    first.close();
    second.close();
  });
});
