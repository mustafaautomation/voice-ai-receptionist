import { CLINIC, isServiceId } from "../clinic.js";
import type { AppointmentStore } from "../calendar/store.js";
import { DuplicateSlotError } from "../calendar/store.js";
import { newId } from "./ids.js";
import { normalizePhone } from "./phone.js";
import { addDays, clinicDate, evaluateChange, evaluateSlot, isOpenAt, slotsForDate } from "./rules.js";
import { toUtcIso } from "./time.js";
import { DateTime } from "luxon";
import type {
  AvailabilityInput,
  AvailabilityResult,
  BookInput,
  BookResult,
  CancelInput,
  CancelResult,
  RescheduleInput,
  RescheduleResult,
} from "./types.js";

function cleanName(name: string): string | null {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed.length < 2 || trimmed.length > 120) return null;
  return trimmed;
}

export function checkAvailability(store: AppointmentStore, input: AvailabilityInput, now: Date): AvailabilityResult {
  const days = input.days ?? (input.date ? 1 : 7);
  const startDate = input.date ?? clinicDate(now);
  const booked = new Set(store.bookedStarts());
  const dates = [];
  for (let i = 0; i < days; i += 1) {
    const date = addDays(startDate, i);
    dates.push(slotsForDate(date, now, booked));
  }
  return {
    ok: true,
    timezone: CLINIC.timezone,
    afterHours: !isOpenAt(now),
    dates,
  };
}

export function bookInStore(store: AppointmentStore, input: BookInput, now: Date): BookResult {
  const patientName = cleanName(input.patientName);
  if (!patientName) {
    return { ok: false, code: "invalid_name", message: "I need the patient's full name." };
  }
  const phone = normalizePhone(input.phone);
  if (!phone) {
    return { ok: false, code: "invalid_phone", message: "I need a valid phone number, including area code." };
  }
  if (!isServiceId(input.service)) {
    return {
      ok: false,
      code: "invalid_service",
      message: `Service must be one of: ${CLINIC.services.join(", ")}.`,
    };
  }
  const booked = new Set(store.bookedStarts());
  const check = evaluateSlot(input.start, now, booked);
  if (!check.ok) return check;

  const timestamp = toUtcIso(DateTime.fromJSDate(now, { zone: "utc" }));
  const appointment = {
    id: newId("apt"),
    patientName,
    phone,
    service: input.service,
    startsAt: check.start,
    endsAt: check.end,
    status: "booked" as const,
    notes: input.notes?.trim() ?? "",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  try {
    store.insert(appointment);
  } catch (error) {
    if (error instanceof DuplicateSlotError) {
      return {
        ok: false,
        code: "slot_taken",
        message: "That time is already booked. I can look for another opening.",
      };
    }
    throw error;
  }
  return { ok: true, appointment };
}

export function rescheduleInStore(store: AppointmentStore, input: RescheduleInput, now: Date): RescheduleResult {
  const existing = store.get(input.appointmentId);
  if (!existing) return { ok: false, code: "not_found", message: "I could not find that appointment." };
  const change = evaluateChange(existing.startsAt, existing.status, now);
  if (!change.ok) return change;

  const booked = new Set(store.bookedStarts().filter((start) => start !== existing.startsAt));
  const check = evaluateSlot(input.start, now, booked);
  if (!check.ok) return check;

  const updated = {
    ...existing,
    startsAt: check.start,
    endsAt: check.end,
    updatedAt: toUtcIso(DateTime.fromJSDate(now, { zone: "utc" })),
  };
  try {
    store.update(updated);
  } catch (error) {
    if (error instanceof DuplicateSlotError) {
      return {
        ok: false,
        code: "slot_taken",
        message: "That time is already booked. I can look for another opening.",
      };
    }
    throw error;
  }
  return { ok: true, appointment: updated };
}

export function cancelInStore(store: AppointmentStore, input: CancelInput, now: Date): CancelResult {
  const existing = store.get(input.appointmentId);
  if (!existing) return { ok: false, code: "not_found", message: "I could not find that appointment." };
  const change = evaluateChange(existing.startsAt, existing.status, now);
  if (!change.ok) return change;
  const reason = input.reason?.trim();
  const notes = reason ? [existing.notes, `Cancelled: ${reason}`].filter(Boolean).join(" ") : existing.notes;
  const updated = {
    ...existing,
    status: "cancelled" as const,
    notes,
    updatedAt: toUtcIso(DateTime.fromJSDate(now, { zone: "utc" })),
  };
  store.update(updated);
  return { ok: true, appointment: updated };
}
