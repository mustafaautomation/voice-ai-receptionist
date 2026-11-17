import type { ServiceId } from "../clinic.js";

export type AppointmentStatus = "booked" | "cancelled";

export type Appointment = {
  id: string;
  patientName: string;
  phone: string;
  service: ServiceId;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type AvailabilityInput = {
  date?: string;
  days?: number;
  service?: ServiceId;
};

export type AvailabilityResult = {
  ok: true;
  timezone: string;
  afterHours: boolean;
  dates: Array<{
    date: string;
    closed: boolean;
    slots: Array<{ start: string; end: string; label: string }>;
  }>;
};

export type BookInput = {
  start: string;
  patientName: string;
  phone: string;
  service: ServiceId;
  notes?: string;
  email?: string;
};

export type BookSuccess = { ok: true; appointment: Appointment };
export type Fail = { ok: false; code: string; message: string };
export type BookResult = BookSuccess | Fail;

export type RescheduleInput = { appointmentId: string; start: string };
export type RescheduleResult = BookSuccess | Fail;

export type CancelInput = { appointmentId: string; reason?: string };
export type CancelResult = BookSuccess | Fail;
