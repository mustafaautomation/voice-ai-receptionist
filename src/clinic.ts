export const CLINIC = {
  name: "Brightside Dental",
  timezone: "America/Chicago",
  slotMinutes: 30,
  cancellationWindowHours: 24,
  phoneDisplay: "(312) 555-0140",
  phoneE164: "+13125550140",
  address: "1840 W North Ave, Chicago, IL 60622",
  transferNumber: "+13125550199",
  services: ["cleaning", "exam", "filling", "emergency"] as const,
} as const;

export type ServiceId = (typeof CLINIC.services)[number];

export const SERVICE_LABELS: Record<ServiceId, string> = {
  cleaning: "Cleaning",
  exam: "New patient exam",
  filling: "Filling",
  emergency: "Tooth pain visit",
};

export type DayHours = { openMin: number; closeMin: number };

/** Luxon weekday: 1 = Monday … 7 = Sunday. Sunday is closed. */
export function hoursForWeekday(weekday: number): DayHours | null {
  if (weekday >= 1 && weekday <= 5) return { openMin: 8 * 60, closeMin: 17 * 60 };
  if (weekday === 6) return { openMin: 9 * 60, closeMin: 13 * 60 };
  return null;
}

export function isServiceId(value: string): value is ServiceId {
  return (CLINIC.services as readonly string[]).includes(value);
}
