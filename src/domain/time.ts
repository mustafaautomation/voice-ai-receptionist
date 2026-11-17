import { DateTime } from "luxon";
import { CLINIC } from "../clinic.js";

export function toUtcIso(dt: DateTime): string {
  return dt.toUTC().toFormat("yyyy-MM-dd'T'HH:mm:ss'Z'");
}

export function parseToUtcIso(input: string): string | null {
  const dt = DateTime.fromISO(input, { setZone: true });
  if (!dt.isValid) return null;
  return toUtcIso(dt);
}

export function clinicNow(now: Date): DateTime {
  return DateTime.fromJSDate(now, { zone: "utc" }).setZone(CLINIC.timezone);
}

export function formatInClinic(isoUtc: string): string {
  const dt = DateTime.fromISO(isoUtc, { zone: "utc" }).setZone(CLINIC.timezone);
  if (!dt.isValid) return isoUtc;
  return dt.toFormat("ccc LLL d, h:mm a") + " CT";
}

export function formatStamp(isoUtc: string): string {
  const dt = DateTime.fromISO(isoUtc, { zone: "utc" }).setZone(CLINIC.timezone);
  if (!dt.isValid) return isoUtc;
  return dt.toFormat("ccc LLL d, h:mm a");
}
