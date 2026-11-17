import { DateTime } from "luxon";
import { CLINIC, hoursForWeekday } from "../clinic.js";
import { clinicNow, parseToUtcIso, toUtcIso } from "./time.js";

export type RuleCode =
  | "invalid_time"
  | "in_the_past"
  | "closed"
  | "outside_hours"
  | "misaligned_slot"
  | "slot_taken"
  | "too_far";

export type Slot = { start: string; end: string; label: string };

export type SlotCheck =
  | { ok: true; start: string; end: string }
  | { ok: false; code: RuleCode; message: string };

const MAX_LEAD_DAYS = 60;

export function isOpenAt(now: Date): boolean {
  const local = clinicNow(now);
  const hours = hoursForWeekday(local.weekday);
  if (!hours) return false;
  const minutes = local.hour * 60 + local.minute;
  return minutes >= hours.openMin && minutes < hours.closeMin;
}

export function slotLabel(startIso: string): string {
  const local = DateTime.fromISO(startIso, { zone: "utc" }).setZone(CLINIC.timezone);
  return local.toFormat("ccc LLL d, h:mm a") + " CT";
}

export function evaluateSlot(startInput: string, now: Date, bookedStarts: ReadonlySet<string>): SlotCheck {
  const startIso = parseToUtcIso(startInput);
  if (!startIso) {
    return { ok: false, code: "invalid_time", message: "That time is not a valid date." };
  }
  const local = DateTime.fromISO(startIso, { zone: "utc" }).setZone(CLINIC.timezone);
  const nowLocal = clinicNow(now);
  if (local.toMillis() <= nowLocal.toMillis()) {
    return { ok: false, code: "in_the_past", message: "That time has already passed." };
  }
  if (local.diff(nowLocal, "days").days > MAX_LEAD_DAYS) {
    return {
      ok: false,
      code: "too_far",
      message: `Brightside Dental books up to ${MAX_LEAD_DAYS} days ahead.`,
    };
  }
  const hours = hoursForWeekday(local.weekday);
  if (!hours) {
    return { ok: false, code: "closed", message: "Brightside Dental is closed that day." };
  }
  const minutes = local.hour * 60 + local.minute;
  if (local.second !== 0) {
    return {
      ok: false,
      code: "misaligned_slot",
      message: "Appointments start on the hour or half hour.",
    };
  }
  if (minutes < hours.openMin || minutes + CLINIC.slotMinutes > hours.closeMin) {
    return {
      ok: false,
      code: "outside_hours",
      message: "That time is outside opening hours.",
    };
  }
  if ((minutes - hours.openMin) % CLINIC.slotMinutes !== 0) {
    return {
      ok: false,
      code: "misaligned_slot",
      message: "Appointments start on the hour or half hour during opening hours.",
    };
  }
  if (bookedStarts.has(startIso)) {
    return {
      ok: false,
      code: "slot_taken",
      message: "That time is already booked. I can look for another opening.",
    };
  }
  const end = toUtcIso(local.plus({ minutes: CLINIC.slotMinutes }));
  return { ok: true, start: startIso, end };
}

export type DayAvailability = {
  date: string;
  closed: boolean;
  slots: Slot[];
};

export function slotsForDate(date: string, now: Date, bookedStarts: ReadonlySet<string>): DayAvailability {
  const day = DateTime.fromISO(date, { zone: CLINIC.timezone });
  if (!day.isValid || day.toISODate() !== date) {
    return { date, closed: true, slots: [] };
  }
  const hours = hoursForWeekday(day.weekday);
  if (!hours) return { date, closed: true, slots: [] };

  const slots: Slot[] = [];
  for (let minutes = hours.openMin; minutes + CLINIC.slotMinutes <= hours.closeMin; minutes += CLINIC.slotMinutes) {
    const local = day.set({
      hour: Math.floor(minutes / 60),
      minute: minutes % 60,
      second: 0,
      millisecond: 0,
    });
    const start = toUtcIso(local);
    const check = evaluateSlot(start, now, bookedStarts);
    if (!check.ok) continue;
    slots.push({ start: check.start, end: check.end, label: slotLabel(check.start) });
  }
  return { date, closed: false, slots };
}

export function addDays(date: string, days: number): string {
  const day = DateTime.fromISO(date, { zone: CLINIC.timezone }).plus({ days });
  return day.toISODate() ?? date;
}

export function clinicDate(now: Date): string {
  return clinicNow(now).toISODate() ?? "1970-01-01";
}

export type ChangeCode = "not_found" | "already_cancelled" | "in_the_past" | "inside_cancellation_window";

export function evaluateChange(
  startsAt: string,
  status: "booked" | "cancelled",
  now: Date,
): { ok: true } | { ok: false; code: ChangeCode; message: string } {
  if (status === "cancelled") {
    return { ok: false, code: "already_cancelled", message: "That appointment is already cancelled." };
  }
  const start = DateTime.fromISO(startsAt, { zone: "utc" });
  const nowDt = DateTime.fromJSDate(now, { zone: "utc" });
  if (!start.isValid) {
    return { ok: false, code: "in_the_past", message: "That appointment time is not valid." };
  }
  if (start.toMillis() <= nowDt.toMillis()) {
    return { ok: false, code: "in_the_past", message: "That appointment has already started." };
  }
  const msUntil = start.toMillis() - nowDt.toMillis();
  if (msUntil < CLINIC.cancellationWindowHours * 60 * 60 * 1000) {
    return {
      ok: false,
      code: "inside_cancellation_window",
      message: `Changes need ${CLINIC.cancellationWindowHours} hours notice. I can transfer you to the front desk.`,
    };
  }
  return { ok: true };
}
