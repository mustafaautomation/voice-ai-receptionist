import { bookInStore, cancelInStore, checkAvailability, rescheduleInStore } from "../domain/scheduling.js";
import type {
  Appointment,
  AppointmentStatus,
  AvailabilityInput,
  AvailabilityResult,
  BookInput,
  BookResult,
  CancelInput,
  CancelResult,
  Fail,
  RescheduleInput,
  RescheduleResult,
} from "../domain/types.js";
import { MemoryAppointmentStore } from "./memory.js";
import type { CalendarProvider } from "./types.js";

type FetchLike = typeof fetch;

export type RelayCalendarOptions = {
  /** Base URL of the document store, e.g. https://example.workers.dev */
  baseUrl: string;
  token: string;
  /** Tag written on every doc so this demo never reads another app's rows. */
  namespace: string;
  now: () => Date;
  fetchImpl?: FetchLike;
};

type RelayDoc = { id: string; data: Record<string, unknown> };

const UNAVAILABLE: Fail = {
  ok: false,
  code: "calendar_unavailable",
  message: "I cannot reach the calendar right now. I can transfer you to the front desk.",
};

const SLOT_TAKEN: Fail = {
  ok: false,
  code: "slot_taken",
  message: "That time is already booked. I can look for another opening.",
};

class RelayError extends Error {}

/** Records the rows the domain functions write, so they can be pushed to the store. */
class RecordingStore extends MemoryAppointmentStore {
  readonly writes: Appointment[] = [];

  override insert(row: Appointment): void {
    super.insert(row);
    this.writes.push({ ...row });
  }

  override update(row: Appointment): void {
    super.update(row);
    this.writes.push({ ...row });
  }
}

/**
 * Calendar backed by a remote JSON document store (Cloudflare D1 behind a Worker).
 * The scheduling rules run in this process on a fresh snapshot. The store's atomic
 * reserve call, keyed on the slot start, is what stops two callers taking the same slot,
 * even when requests land on different serverless instances.
 */
export class RelayCalendar implements CalendarProvider {
  readonly kind = "relay" as const;
  private readonly base: string;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly options: RelayCalendarOptions) {
    this.base = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async checkAvailability(input: AvailabilityInput): Promise<AvailabilityResult> {
    const store = new MemoryAppointmentStore(await this.loadAll());
    return checkAvailability(store, input, this.options.now());
  }

  async book(input: BookInput): Promise<BookResult> {
    return this.mutate((store) => bookInStore(store, input, this.options.now()));
  }

  async reschedule(input: RescheduleInput): Promise<RescheduleResult> {
    return this.mutate((store) => rescheduleInStore(store, input, this.options.now()));
  }

  async cancel(input: CancelInput): Promise<CancelResult> {
    return this.mutate((store) => cancelInStore(store, input, this.options.now()));
  }

  async list(filter?: { status?: AppointmentStatus }): Promise<Appointment[]> {
    return new MemoryAppointmentStore(await this.loadAll()).list(filter);
  }

  async get(id: string): Promise<Appointment | null> {
    return new MemoryAppointmentStore(await this.loadAll()).get(id);
  }

  private async mutate(run: (store: RecordingStore) => BookResult): Promise<BookResult> {
    let store: RecordingStore;
    try {
      store = new RecordingStore(await this.loadAll());
    } catch (error) {
      if (error instanceof RelayError) return UNAVAILABLE;
      throw error;
    }
    const result = run(store);
    if (!result.ok) return result;
    try {
      for (const row of store.writes) {
        const outcome = await this.persist(row);
        if (outcome === "slot_taken") return SLOT_TAKEN;
      }
    } catch (error) {
      if (error instanceof RelayError) return UNAVAILABLE;
      throw error;
    }
    return result;
  }

  private docId(id: string): string {
    return `${this.options.namespace}:${id}`;
  }

  private toData(row: Appointment): Record<string, unknown> {
    return {
      ...row,
      app: this.options.namespace,
      slot_key: `${this.options.namespace}|${row.startsAt}`,
    };
  }

  private async persist(row: Appointment): Promise<"ok" | "slot_taken"> {
    const path = `/v1/store/appointments/${encodeURIComponent(this.docId(row.id))}`;
    if (row.status === "booked") {
      const response = await this.request(`${path}/reserve`, { method: "POST", body: JSON.stringify(this.toData(row)) });
      if (response.status === 409) return "slot_taken";
      if (response.status !== 201 && response.status !== 200) throw new RelayError(`reserve failed (${response.status})`);
      return "ok";
    }
    const response = await this.request(path, { method: "PUT", body: JSON.stringify(this.toData(row)) });
    if (!response.ok) throw new RelayError(`update failed (${response.status})`);
    return "ok";
  }

  private async loadAll(): Promise<Appointment[]> {
    const rows: Appointment[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const params = new URLSearchParams({ filter_key: "app", filter_value: this.options.namespace, limit: "200" });
      if (cursor) params.set("cursor", cursor);
      const response = await this.request(`/v1/store/appointments?${params.toString()}`, { method: "GET" });
      if (!response.ok) throw new RelayError(`list failed (${response.status})`);
      const body = (await response.json()) as { items?: RelayDoc[]; next_cursor?: string | null };
      for (const doc of body.items ?? []) {
        const row = fromDoc(doc);
        if (row) rows.push(row);
      }
      cursor = body.next_cursor ?? null;
      if (!cursor) break;
    }
    return rows;
  }

  private async request(path: string, init: { method: string; body?: string }): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.base}${path}`, {
        method: init.method,
        headers: {
          authorization: `Bearer ${this.options.token}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
        },
        body: init.body,
        signal: AbortSignal.timeout(8000),
      });
    } catch (error) {
      throw new RelayError(error instanceof Error ? error.message : "network error");
    }
  }
}

function fromDoc(doc: RelayDoc): Appointment | null {
  const data = doc.data;
  if (typeof data.id !== "string" || typeof data.startsAt !== "string" || typeof data.endsAt !== "string") return null;
  if (data.status !== "booked" && data.status !== "cancelled") return null;
  return {
    id: data.id,
    patientName: String(data.patientName ?? ""),
    phone: String(data.phone ?? ""),
    service: data.service as Appointment["service"],
    startsAt: data.startsAt,
    endsAt: data.endsAt,
    status: data.status,
    notes: String(data.notes ?? ""),
    createdAt: String(data.createdAt ?? ""),
    updatedAt: String(data.updatedAt ?? ""),
  };
}
