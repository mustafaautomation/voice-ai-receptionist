import { DateTime } from "luxon";
import { hoursForWeekday } from "./clinic.js";
import { CallStore } from "./calls/store.js";
import { SqliteAppointmentStore } from "./calendar/sqlite.js";
import type { SqliteDatabase } from "./db/database.js";
import type { Appointment } from "./domain/types.js";
import { clinicNow, formatInClinic, toUtcIso } from "./domain/time.js";

function at(day: DateTime, hour: number, minute: number): string {
  return toUtcIso(day.set({ hour, minute, second: 0, millisecond: 0 }));
}

function nextOpenDays(now: Date, count: number): DateTime[] {
  const found: DateTime[] = [];
  let day = clinicNow(now).startOf("day").plus({ days: 1 });
  for (let i = 0; i < 21 && found.length < count; i += 1) {
    if (hoursForWeekday(day.weekday)) found.push(day);
    day = day.plus({ days: 1 });
  }
  if (found.length < count) throw new Error("Could not find upcoming open days");
  return found;
}

function previousOpenDay(now: Date): DateTime {
  let day = clinicNow(now).startOf("day").minus({ days: 1 });
  for (let i = 0; i < 14; i += 1) {
    if (hoursForWeekday(day.weekday)) return day;
    day = day.minus({ days: 1 });
  }
  throw new Error("Could not find a previous open day");
}

function stamp(now: Date, minutesAgo: number): string {
  return toUtcIso(DateTime.fromJSDate(now, { zone: "utc" }).minus({ minutes: minutesAgo }));
}

export function seedIfEmpty(db: SqliteDatabase, now: Date): boolean {
  const calls = new CallStore(db);
  if (calls.count() > 0) return false;
  const [first, second] = nextOpenDays(now, 2);
  if (!first || !second) throw new Error("Missing open days");
  const past = previousOpenDay(now);
  const mayaStart = at(first, 10, 0);
  const andreStart = at(second, 11, 0);
  const priyaStart = at(past, 11, 0);
  const created = stamp(now, 60);

  const appointments: Appointment[] = [
    {
      id: "apt_maya",
      patientName: "Maya Chen",
      phone: "+13125550121",
      service: "cleaning",
      startsAt: mayaStart,
      endsAt: toUtcIso(DateTime.fromISO(mayaStart, { zone: "utc" }).plus({ minutes: 30 })),
      status: "booked",
      notes: "",
      createdAt: created,
      updatedAt: created,
    },
    {
      id: "apt_andre",
      patientName: "Andre Brooks",
      phone: "+13125550122",
      service: "exam",
      startsAt: andreStart,
      endsAt: toUtcIso(DateTime.fromISO(andreStart, { zone: "utc" }).plus({ minutes: 30 })),
      status: "booked",
      notes: "Moved from an earlier slot.",
      createdAt: created,
      updatedAt: created,
    },
    {
      id: "apt_priya",
      patientName: "Priya Shah",
      phone: "+13125550123",
      service: "filling",
      startsAt: priyaStart,
      endsAt: toUtcIso(DateTime.fromISO(priyaStart, { zone: "utc" }).plus({ minutes: 30 })),
      status: "cancelled",
      notes: "Cancelled: schedule conflict",
      createdAt: created,
      updatedAt: created,
    },
  ];
  const store = new SqliteAppointmentStore(db);
  for (const appointment of appointments) store.insert(appointment);

  insertCall(db, {
    id: "call_maya",
    vapiCallId: "vapi_maya",
    callerNumber: "+13125550121",
    callerName: "Maya Chen",
    startedAt: stamp(now, 50),
    endedAt: stamp(now, 46),
    status: "completed",
    outcome: "booked",
    summary: `Booked a cleaning for ${formatInClinic(mayaStart)}.`,
    transcript: [
      "assistant: Thank you for calling Brightside Dental. I can share our hours, or book, move, and cancel a visit. What do you need?",
      "user: Hi, this is Maya Chen. I would like a cleaning. My number is 312-555-0121.",
      `assistant: The next opening I have is ${formatInClinic(mayaStart)}. Should I book that?`,
      "user: Yes, please.",
      `assistant: You are booked for a cleaning on ${formatInClinic(mayaStart)}. We will see you then.`,
    ].join("\n"),
    endedReason: "assistant-ended-call",
    afterHours: 0,
    crmProvider: "memory",
    crmStatus: "pushed",
    crmExternalId: "mem_vapi_maya",
    crmError: null,
  });
  insertTool(db, {
    id: "tool_maya_check",
    callRowId: "call_maya",
    toolCallId: "tc_maya_check",
    name: "check_availability",
    arguments: { service: "cleaning" },
    result: { ok: true, dates: [{ slots: [{ start: mayaStart, label: formatInClinic(mayaStart) }] }] },
    createdAt: stamp(now, 49),
  });
  insertTool(db, {
    id: "tool_maya_book",
    callRowId: "call_maya",
    toolCallId: "tc_maya_book",
    name: "book_appointment",
    arguments: { start: mayaStart, patientName: "Maya Chen", phone: "+13125550121", service: "cleaning" },
    result: { ok: true, appointment: appointments[0] },
    createdAt: stamp(now, 48),
  });
  insertLead(db, {
    id: "lead_maya",
    callRowId: "call_maya",
    name: "Maya Chen",
    phone: "+13125550121",
    summary: `Booked a cleaning for ${formatInClinic(mayaStart)}.`,
    outcome: "booked",
    appointmentId: "apt_maya",
    createdAt: stamp(now, 46),
  });

  insertCall(db, {
    id: "call_helen",
    vapiCallId: "vapi_helen",
    callerNumber: "+13125550124",
    callerName: "Helen Cho",
    startedAt: stamp(now, 180),
    endedAt: stamp(now, 176),
    status: "completed",
    outcome: "transferred",
    summary: "Caller was upset about a bill and was transferred to the front desk.",
    transcript: [
      "assistant: Thank you for calling Brightside Dental. How can I help?",
      "user: This is Helen Cho. I am looking at a bill that makes no sense and I want a person, not a recording.",
      "assistant: I am sorry this has been frustrating. I will transfer you to the front desk now.",
    ].join("\n"),
    endedReason: "assistant-forwarded-call",
    afterHours: 0,
    crmProvider: "memory",
    crmStatus: "pushed",
    crmExternalId: "mem_vapi_helen",
    crmError: null,
  });
  insertTool(db, {
    id: "tool_helen_transfer",
    callRowId: "call_helen",
    toolCallId: "tc_helen_transfer",
    name: "transfer_to_human",
    arguments: { reason: "Caller is upset about a billing charge and asked for a person." },
    result: { ok: true, transfer: true, destination: "+13125550199" },
    createdAt: stamp(now, 178),
  });

  insertCall(db, {
    id: "call_luis",
    vapiCallId: "vapi_luis",
    callerNumber: "+13125550125",
    callerName: "Luis Ortega",
    startedAt: stamp(now, 240),
    endedAt: stamp(now, 237),
    status: "completed",
    outcome: "faq",
    summary: "Asked for Saturday hours and whether new patients are accepted.",
    transcript: [
      "assistant: Thank you for calling Brightside Dental. How can I help?",
      "user: Are you open on Saturday, and do you take new patients?",
      "assistant: Saturday hours are 9:00 AM to 1:00 PM Central. Yes, we take new patients.",
    ].join("\n"),
    endedReason: "customer-ended-call",
    afterHours: 0,
    crmProvider: "memory",
    crmStatus: "pushed",
    crmExternalId: "mem_vapi_luis",
    crmError: null,
  });

  insertCall(db, {
    id: "call_samir",
    vapiCallId: "vapi_samir",
    callerNumber: "+13125550126",
    callerName: "Samir Patel",
    startedAt: stamp(now, 300),
    endedAt: stamp(now, 299),
    status: "completed",
    outcome: "wrong_number",
    summary: "Caller was trying to reach a different business.",
    transcript: [
      "assistant: Thank you for calling Brightside Dental. How can I help?",
      "user: Oh, sorry. I was trying to reach a hardware store. Wrong number.",
      "assistant: No problem. Have a good day.",
    ].join("\n"),
    endedReason: "customer-ended-call",
    afterHours: 0,
    crmProvider: "memory",
    crmStatus: "pushed",
    crmExternalId: "mem_vapi_samir",
    crmError: null,
  });

  insertCall(db, {
    id: "call_priya",
    vapiCallId: "vapi_priya",
    callerNumber: "+13125550123",
    callerName: "Priya Shah",
    startedAt: stamp(now, 400),
    endedAt: stamp(now, 396),
    status: "completed",
    outcome: "cancelled",
    summary: "Cancelled a filling outside the 24 hour window.",
    transcript: [
      "user: This is Priya Shah. I need to cancel my filling.",
      "assistant: I can cancel that visit. The 24 hour notice window is still open.",
      "user: Please cancel it.",
    ].join("\n"),
    endedReason: "assistant-ended-call",
    afterHours: 0,
    crmProvider: "memory",
    crmStatus: "pushed",
    crmExternalId: "mem_vapi_priya",
    crmError: null,
  });
  insertTool(db, {
    id: "tool_priya_cancel",
    callRowId: "call_priya",
    toolCallId: "tc_priya_cancel",
    name: "cancel_appointment",
    arguments: { appointmentId: "apt_priya", reason: "schedule conflict" },
    result: { ok: true, appointment: appointments[2] },
    createdAt: stamp(now, 398),
  });

  insertCall(db, {
    id: "call_andre",
    vapiCallId: "vapi_andre",
    callerNumber: "+13125550122",
    callerName: "Andre Brooks",
    startedAt: stamp(now, 90),
    endedAt: stamp(now, 86),
    status: "completed",
    outcome: "rescheduled",
    summary: `Moved a new patient exam to ${formatInClinic(andreStart)}.`,
    transcript: [
      "user: This is Andre Brooks. Can I move my exam later in the week?",
      `assistant: I moved the exam to ${formatInClinic(andreStart)}.`,
      "user: That works. Thank you.",
    ].join("\n"),
    endedReason: "assistant-ended-call",
    afterHours: 0,
    crmProvider: "memory",
    crmStatus: "pushed",
    crmExternalId: "mem_vapi_andre",
    crmError: null,
  });
  insertTool(db, {
    id: "tool_andre_reschedule",
    callRowId: "call_andre",
    toolCallId: "tc_andre_reschedule",
    name: "reschedule_appointment",
    arguments: { appointmentId: "apt_andre", start: andreStart },
    result: { ok: true, appointment: appointments[1] },
    createdAt: stamp(now, 88),
  });

  return true;
}

function insertCall(db: SqliteDatabase, row: Record<string, string | number | null>): void {
  db.prepare(
    `INSERT INTO calls (
      id, vapi_call_id, caller_number, caller_name, started_at, ended_at, status, outcome,
      summary, transcript, ended_reason, after_hours, crm_provider, crm_status, crm_external_id, crm_error
    ) VALUES (
      @id, @vapiCallId, @callerNumber, @callerName, @startedAt, @endedAt, @status, @outcome,
      @summary, @transcript, @endedReason, @afterHours, @crmProvider, @crmStatus, @crmExternalId, @crmError
    )`,
  ).run(row);
}

function insertTool(db: SqliteDatabase, row: {
  id: string;
  callRowId: string;
  toolCallId: string;
  name: string;
  arguments: unknown;
  result: unknown;
  createdAt: string;
}): void {
  db.prepare(
    `INSERT INTO tool_calls (id, call_row_id, tool_call_id, name, arguments_json, result_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.callRowId, row.toolCallId, row.name, JSON.stringify(row.arguments), JSON.stringify(row.result), row.createdAt);
}

function insertLead(db: SqliteDatabase, row: {
  id: string;
  callRowId: string;
  name: string;
  phone: string;
  summary: string;
  outcome: string;
  appointmentId: string;
  createdAt: string;
}): void {
  db.prepare(
    `INSERT INTO leads (
      id, call_row_id, name, phone, summary, outcome, appointment_id, interest,
      crm_provider, crm_status, crm_external_id, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.callRowId,
    row.name,
    row.phone,
    row.summary,
    row.outcome,
    row.appointmentId,
    "cleaning",
    "memory",
    "pushed",
    `mem_${row.callRowId}`,
    JSON.stringify(row),
    row.createdAt,
  );
}
