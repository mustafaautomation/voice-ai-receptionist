import type {
  AvailabilityInput,
  AvailabilityResult,
  BookInput,
  BookResult,
  CancelInput,
  CancelResult,
  RescheduleInput,
  RescheduleResult,
  Appointment,
  AppointmentStatus,
} from "../domain/types.js";

export interface CalendarProvider {
  readonly kind: "memory" | "sqlite" | "calcom";
  checkAvailability(input: AvailabilityInput): Promise<AvailabilityResult>;
  book(input: BookInput): Promise<BookResult>;
  reschedule(input: RescheduleInput): Promise<RescheduleResult>;
  cancel(input: CancelInput): Promise<CancelResult>;
  list(filter?: { status?: AppointmentStatus }): Promise<Appointment[]>;
  get(id: string): Promise<Appointment | null>;
}
