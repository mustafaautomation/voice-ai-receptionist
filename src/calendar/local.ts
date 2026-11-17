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
import type { AppointmentStore } from "./store.js";
import type { CalendarProvider } from "./types.js";

export class LocalCalendar implements CalendarProvider {
  constructor(
    readonly kind: "memory" | "sqlite",
    private readonly store: AppointmentStore,
    private readonly now: () => Date,
  ) {}

  checkAvailability(input: AvailabilityInput): Promise<AvailabilityResult> {
    return Promise.resolve(checkAvailability(this.store, input, this.now()));
  }

  book(input: BookInput): Promise<BookResult> {
    return Promise.resolve(bookInStore(this.store, input, this.now()));
  }

  reschedule(input: RescheduleInput): Promise<RescheduleResult> {
    return Promise.resolve(rescheduleInStore(this.store, input, this.now()));
  }

  cancel(input: CancelInput): Promise<CancelResult> {
    return Promise.resolve(cancelInStore(this.store, input, this.now()));
  }

  list(filter?: { status?: AppointmentStatus }): Promise<Appointment[]> {
    return Promise.resolve(this.store.list(filter));
  }

  get(id: string): Promise<Appointment | null> {
    return Promise.resolve(this.store.get(id));
  }
}
