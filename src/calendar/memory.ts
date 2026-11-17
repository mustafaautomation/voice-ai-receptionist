import type { Appointment, AppointmentStatus } from "../domain/types.js";
import { DuplicateSlotError, type AppointmentStore } from "./store.js";

export class MemoryAppointmentStore implements AppointmentStore {
  private rows: Appointment[];

  constructor(seed: Appointment[] = []) {
    this.rows = seed.map((row) => ({ ...row }));
  }

  bookedStarts(): string[] {
    return this.rows.filter((row) => row.status === "booked").map((row) => row.startsAt);
  }

  insert(row: Appointment): void {
    if (row.status === "booked" && this.bookedStarts().includes(row.startsAt)) {
      throw new DuplicateSlotError();
    }
    this.rows.push({ ...row });
  }

  update(row: Appointment): void {
    const index = this.rows.findIndex((item) => item.id === row.id);
    if (index < 0) throw new Error(`Unknown appointment ${row.id}`);
    if (row.status === "booked") {
      const clash = this.rows.find(
        (item) => item.id !== row.id && item.status === "booked" && item.startsAt === row.startsAt,
      );
      if (clash) throw new DuplicateSlotError();
    }
    this.rows[index] = { ...row };
  }

  get(id: string): Appointment | null {
    return this.rows.find((row) => row.id === id) ?? null;
  }

  list(filter?: { status?: AppointmentStatus }): Appointment[] {
    return this.rows
      .filter((row) => (filter?.status ? row.status === filter.status : true))
      .map((row) => ({ ...row }))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }
}
