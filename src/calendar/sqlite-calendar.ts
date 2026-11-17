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
  RescheduleInput,
  RescheduleResult,
} from "../domain/types.js";
import { SqliteAppointmentStore } from "./sqlite.js";
import type { CalendarProvider } from "./types.js";

/**
 * SQLite calendar. Booking and reschedule run inside a transaction so two
 * overlapping requests cannot both commit the same start time. The partial
 * unique index is the backstop if the check and insert race.
 */
export class SqliteCalendar implements CalendarProvider {
  readonly kind = "sqlite" as const;
  private readonly store: SqliteAppointmentStore;

  constructor(
    store: SqliteAppointmentStore,
    private readonly now: () => Date,
  ) {
    this.store = store;
  }

  checkAvailability(input: AvailabilityInput): Promise<AvailabilityResult> {
    return Promise.resolve(checkAvailability(this.store, input, this.now()));
  }

  book(input: BookInput): Promise<BookResult> {
    return Promise.resolve(this.store.transaction(() => bookInStore(this.store, input, this.now())));
  }

  reschedule(input: RescheduleInput): Promise<RescheduleResult> {
    return Promise.resolve(this.store.transaction(() => rescheduleInStore(this.store, input, this.now())));
  }

  cancel(input: CancelInput): Promise<CancelResult> {
    return Promise.resolve(this.store.transaction(() => cancelInStore(this.store, input, this.now())));
  }

  list(filter?: { status?: AppointmentStatus }): Promise<Appointment[]> {
    return Promise.resolve(this.store.list(filter));
  }

  get(id: string): Promise<Appointment | null> {
    return Promise.resolve(this.store.get(id));
  }
}
