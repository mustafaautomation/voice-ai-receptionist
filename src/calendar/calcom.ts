import { CLINIC, isServiceId, type ServiceId } from "../clinic.js";
import { evaluateChange, evaluateSlot, isOpenAt } from "../domain/rules.js";
import { normalizePhone } from "../domain/phone.js";
import type {
  Appointment,
  AppointmentStatus,
  AvailabilityInput,
  AvailabilityResult,
  BookInput,
  BookResult,
  CancelInput,
  CancelResult,
  RescheduleInput,
  RescheduleResult,
} from "../domain/types.js";
import { addDays, clinicDate, slotsForDate } from "../domain/rules.js";
import type { CalendarProvider } from "./types.js";

type FetchLike = typeof fetch;

export type CalcomOptions = {
  apiKey: string;
  eventTypeId: string;
  baseUrl: string;
  now: () => Date;
  fetchImpl?: FetchLike;
};

/**
 * Optional Cal.com adapter. Used only when CALENDAR_PROVIDER=calcom.
 * Hours, slot alignment, and the cancellation window are still enforced here
 * before the HTTP call. Cal.com remains the source of truth for conflicts.
 */
export class CalcomCalendar implements CalendarProvider {
  readonly kind = "calcom" as const;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly options: CalcomOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.options.apiKey}`,
      "cal-api-version": "2024-08-13",
      "content-type": "application/json",
    };
  }

  private url(pathname: string): URL {
    const base = this.options.baseUrl.replace(/\/$/, "");
    return new URL(pathname, `${base}/`);
  }

  async checkAvailability(input: AvailabilityInput): Promise<AvailabilityResult> {
    const now = this.options.now();
    const days = input.days ?? (input.date ? 1 : 7);
    const startDate = input.date ?? clinicDate(now);
    const endDate = addDays(startDate, Math.max(days - 1, 0));
    const url = this.url("/v2/slots");
    url.searchParams.set("eventTypeId", this.options.eventTypeId);
    url.searchParams.set("start", `${startDate}T00:00:00Z`);
    url.searchParams.set("end", `${endDate}T23:59:59Z`);
    url.searchParams.set("timeZone", CLINIC.timezone);
    const response = await this.fetchImpl(url, { headers: this.headers() });
    if (!response.ok) {
      throw new Error(`Cal.com slots request failed (${response.status})`);
    }
    const body = (await response.json()) as { data?: Record<string, Array<{ start: string }>> };
    const remote = new Set<string>();
    for (const entries of Object.values(body.data ?? {})) {
      for (const entry of entries) remote.add(entry.start);
    }
    const dates = [];
    for (let i = 0; i < days; i += 1) {
      const date = addDays(startDate, i);
      const local = slotsForDate(date, now, new Set());
      dates.push({
        ...local,
        slots: local.slots.filter((slot) => remoteHas(remote, slot.start)),
      });
    }
    return { ok: true, timezone: CLINIC.timezone, afterHours: !isOpenAt(now), dates };
  }

  async book(input: BookInput): Promise<BookResult> {
    const phone = normalizePhone(input.phone);
    if (!phone) return { ok: false, code: "invalid_phone", message: "I need a valid phone number, including area code." };
    if (!isServiceId(input.service)) {
      return { ok: false, code: "invalid_service", message: `Service must be one of: ${CLINIC.services.join(", ")}.` };
    }
    const check = evaluateSlot(input.start, this.options.now(), new Set());
    if (!check.ok) return check;
    const email = input.email?.trim() || syntheticEmail(phone);
    const response = await this.fetchImpl(this.url("/v2/bookings"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        start: check.start,
        eventTypeId: numberOrString(this.options.eventTypeId),
        attendee: {
          name: input.patientName.trim(),
          email,
          timeZone: CLINIC.timezone,
          phoneNumber: phone,
          language: "en",
        },
        metadata: { service: input.service, source: "brightside-dental-receptionist" },
      }),
    });
    if (response.status === 409) {
      return { ok: false, code: "slot_taken", message: "That time is already booked. I can look for another opening." };
    }
    if (!response.ok) {
      return { ok: false, code: "calendar_unavailable", message: "The calendar could not save that appointment." };
    }
    const body = (await response.json()) as { data?: { uid?: string; id?: string; start?: string; end?: string } };
    const data = body.data ?? {};
    const id = data.uid ?? data.id ?? `cal_${check.start}`;
    const nowIso = new Date(this.options.now()).toISOString().replace(/\.\d{3}Z$/, "Z");
    return {
      ok: true,
      appointment: {
        id,
        patientName: input.patientName.trim(),
        phone,
        service: input.service,
        startsAt: data.start ? normalizeRemote(data.start) : check.start,
        endsAt: data.end ? normalizeRemote(data.end) : check.end,
        status: "booked",
        notes: input.notes?.trim() ?? "",
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    };
  }

  async reschedule(input: RescheduleInput): Promise<RescheduleResult> {
    const existing = await this.get(input.appointmentId);
    if (!existing) return { ok: false, code: "not_found", message: "I could not find that appointment." };
    const change = evaluateChange(existing.startsAt, existing.status, this.options.now());
    if (!change.ok) return change;
    const check = evaluateSlot(input.start, this.options.now(), new Set());
    if (!check.ok) return check;
    const response = await this.fetchImpl(this.url(`/v2/bookings/${encodeURIComponent(input.appointmentId)}/reschedule`), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ start: check.start, reschedulingReason: "Caller asked to move the visit" }),
    });
    if (response.status === 409) {
      return { ok: false, code: "slot_taken", message: "That time is already booked. I can look for another opening." };
    }
    if (!response.ok) {
      return { ok: false, code: "calendar_unavailable", message: "The calendar could not move that appointment." };
    }
    return {
      ok: true,
      appointment: { ...existing, startsAt: check.start, endsAt: check.end, updatedAt: stamp(this.options.now()) },
    };
  }

  async cancel(input: CancelInput): Promise<CancelResult> {
    const existing = await this.get(input.appointmentId);
    if (!existing) return { ok: false, code: "not_found", message: "I could not find that appointment." };
    const change = evaluateChange(existing.startsAt, existing.status, this.options.now());
    if (!change.ok) return change;
    const response = await this.fetchImpl(this.url(`/v2/bookings/${encodeURIComponent(input.appointmentId)}/cancel`), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ cancellationReason: input.reason?.trim() || "Caller asked to cancel" }),
    });
    if (response.status === 404) return { ok: false, code: "not_found", message: "I could not find that appointment." };
    if (!response.ok) {
      return { ok: false, code: "calendar_unavailable", message: "The calendar could not cancel that appointment." };
    }
    return {
      ok: true,
      appointment: {
        ...existing,
        status: "cancelled",
        notes: input.reason?.trim() ? `${existing.notes} Cancelled: ${input.reason.trim()}`.trim() : existing.notes,
        updatedAt: stamp(this.options.now()),
      },
    };
  }

  async list(): Promise<Appointment[]> {
    const url = this.url("/v2/bookings");
    url.searchParams.set("eventTypeId", this.options.eventTypeId);
    url.searchParams.set("take", "100");
    const response = await this.fetchImpl(url, { headers: this.headers() });
    if (!response.ok) throw new Error(`Cal.com bookings request failed (${response.status})`);
    const body = (await response.json()) as { data?: CalBooking[] };
    return (body.data ?? []).map((booking) => mapBooking(booking, this.options.now()));
  }

  async get(id: string): Promise<Appointment | null> {
    const response = await this.fetchImpl(this.url(`/v2/bookings/${encodeURIComponent(id)}`), {
      headers: this.headers(),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Cal.com booking request failed (${response.status})`);
    const body = (await response.json()) as { data?: CalBooking };
    if (!body.data) return null;
    return mapBooking(body.data, this.options.now());
  }
}

type CalBooking = {
  uid?: string;
  id?: string | number;
  start?: string;
  end?: string;
  status?: string;
  attendees?: Array<{ name?: string; phoneNumber?: string; email?: string }>;
  metadata?: { service?: string };
};

function mapBooking(booking: CalBooking, now: Date): Appointment {
  const attendee = booking.attendees?.[0];
  const service: ServiceId = isServiceId(booking.metadata?.service ?? "") ? (booking.metadata?.service as ServiceId) : "exam";
  const status: AppointmentStatus = booking.status === "cancelled" || booking.status === "CANCELLED" ? "cancelled" : "booked";
  const startsAt = normalizeRemote(booking.start ?? stamp(now));
  return {
    id: String(booking.uid ?? booking.id ?? startsAt),
    patientName: attendee?.name ?? "Caller",
    phone: attendee?.phoneNumber ?? "",
    service,
    startsAt,
    endsAt: normalizeRemote(booking.end ?? startsAt),
    status,
    notes: "",
    createdAt: startsAt,
    updatedAt: stamp(now),
  };
}

function remoteHas(remote: Set<string>, start: string): boolean {
  if (remote.has(start)) return true;
  const target = Date.parse(start);
  for (const value of remote) {
    if (Date.parse(value) === target) return true;
  }
  return false;
}

function normalizeRemote(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function stamp(now: Date): string {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function numberOrString(value: string): number | string {
  return /^\d+$/.test(value) ? Number(value) : value;
}

function syntheticEmail(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `${digits}@callers.brightside-dental.invalid`;
}
