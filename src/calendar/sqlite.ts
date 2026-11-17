import { DuplicateSlotError, type AppointmentStore } from "./store.js";
import type { SqliteDatabase } from "../db/database.js";
import { isSqliteConstraint } from "../db/database.js";
import type { Appointment, AppointmentStatus } from "../domain/types.js";
import type { ServiceId } from "../clinic.js";

type AppointmentRow = {
  id: string;
  patient_name: string;
  phone: string;
  service: string;
  starts_at: string;
  ends_at: string;
  status: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

function mapRow(row: AppointmentRow): Appointment {
  return {
    id: row.id,
    patientName: row.patient_name,
    phone: row.phone,
    service: row.service as ServiceId,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status as AppointmentStatus,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteAppointmentStore implements AppointmentStore {
  constructor(private readonly db: SqliteDatabase) {}

  bookedStarts(): string[] {
    const rows = this.db
      .prepare("SELECT starts_at FROM appointments WHERE status = 'booked'")
      .all() as Array<{ starts_at: string }>;
    return rows.map((row) => row.starts_at);
  }

  insert(row: Appointment): void {
    try {
      this.db
        .prepare(
          `INSERT INTO appointments (
            id, patient_name, phone, service, starts_at, ends_at, status, notes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          row.id,
          row.patientName,
          row.phone,
          row.service,
          row.startsAt,
          row.endsAt,
          row.status,
          row.notes,
          row.createdAt,
          row.updatedAt,
        );
    } catch (error) {
      if (isSqliteConstraint(error)) throw new DuplicateSlotError();
      throw error;
    }
  }

  update(row: Appointment): void {
    try {
      this.db
        .prepare(
          `UPDATE appointments
           SET patient_name = ?, phone = ?, service = ?, starts_at = ?, ends_at = ?,
               status = ?, notes = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          row.patientName,
          row.phone,
          row.service,
          row.startsAt,
          row.endsAt,
          row.status,
          row.notes,
          row.updatedAt,
          row.id,
        );
    } catch (error) {
      if (isSqliteConstraint(error)) throw new DuplicateSlotError();
      throw error;
    }
  }

  get(id: string): Appointment | null {
    const row = this.db.prepare("SELECT * FROM appointments WHERE id = ?").get(id) as AppointmentRow | undefined;
    return row ? mapRow(row) : null;
  }

  list(filter?: { status?: AppointmentStatus }): Appointment[] {
    const rows = filter?.status
      ? (this.db.prepare("SELECT * FROM appointments WHERE status = ? ORDER BY starts_at ASC").all(filter.status) as AppointmentRow[])
      : (this.db.prepare("SELECT * FROM appointments ORDER BY starts_at ASC").all() as AppointmentRow[]);
    return rows.map(mapRow);
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}
