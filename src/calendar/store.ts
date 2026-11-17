import type { Appointment, AppointmentStatus } from "../domain/types.js";

export interface AppointmentStore {
  bookedStarts(): string[];
  insert(row: Appointment): void;
  update(row: Appointment): void;
  get(id: string): Appointment | null;
  list(filter?: { status?: AppointmentStatus }): Appointment[];
}

export class DuplicateSlotError extends Error {
  constructor() {
    super("slot_taken");
    this.name = "DuplicateSlotError";
  }
}
