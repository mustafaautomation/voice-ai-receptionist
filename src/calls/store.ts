import { DateTime } from "luxon";
import type { SqliteDatabase } from "../db/database.js";
import { isSqliteConstraint } from "../db/database.js";
import { newId } from "../domain/ids.js";
import { toUtcIso } from "../domain/time.js";

export type CallStatus = "in_progress" | "completed";

export type CallOutcome =
  | "in_progress"
  | "booked"
  | "rescheduled"
  | "cancelled"
  | "transferred"
  | "slot_unavailable"
  | "completed"
  | "wrong_number"
  | "faq";

export type CallRecord = {
  id: string;
  vapiCallId: string;
  callerNumber: string | null;
  callerName: string | null;
  startedAt: string;
  endedAt: string | null;
  status: CallStatus;
  outcome: CallOutcome;
  summary: string | null;
  transcript: string | null;
  endedReason: string | null;
  afterHours: boolean;
  crmProvider: string | null;
  crmStatus: string | null;
  crmExternalId: string | null;
  crmError: string | null;
};

export type ToolCallRecord = {
  id: string;
  callRowId: string;
  toolCallId: string;
  name: string;
  arguments: unknown;
  result: unknown;
  createdAt: string;
};

export type LeadRecord = {
  id: string;
  callRowId: string;
  name: string;
  phone: string;
  summary: string;
  outcome: string;
  appointmentId: string | null;
  interest: string | null;
  crmProvider: string | null;
  crmStatus: string | null;
  crmExternalId: string | null;
  payload: unknown;
  createdAt: string;
};

type CallRow = {
  id: string;
  vapi_call_id: string;
  caller_number: string | null;
  caller_name: string | null;
  started_at: string;
  ended_at: string | null;
  status: CallStatus;
  outcome: CallOutcome;
  summary: string | null;
  transcript: string | null;
  ended_reason: string | null;
  after_hours: number;
  crm_provider: string | null;
  crm_status: string | null;
  crm_external_id: string | null;
  crm_error: string | null;
};

function mapCall(row: CallRow): CallRecord {
  return {
    id: row.id,
    vapiCallId: row.vapi_call_id,
    callerNumber: row.caller_number,
    callerName: row.caller_name,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status,
    outcome: row.outcome,
    summary: row.summary,
    transcript: row.transcript,
    endedReason: row.ended_reason,
    afterHours: row.after_hours === 1,
    crmProvider: row.crm_provider,
    crmStatus: row.crm_status,
    crmExternalId: row.crm_external_id,
    crmError: row.crm_error,
  };
}

function nowIso(now: Date): string {
  return toUtcIso(DateTime.fromJSDate(now, { zone: "utc" }));
}

export class CallStore {
  constructor(private readonly db: SqliteDatabase) {}

  getByVapiId(vapiCallId: string): CallRecord | null {
    const row = this.db.prepare("SELECT * FROM calls WHERE vapi_call_id = ?").get(vapiCallId) as CallRow | undefined;
    return row ? mapCall(row) : null;
  }

  getById(id: string): CallRecord | null {
    const row = this.db.prepare("SELECT * FROM calls WHERE id = ?").get(id) as CallRow | undefined;
    return row ? mapCall(row) : null;
  }

  list(): CallRecord[] {
    const rows = this.db.prepare("SELECT * FROM calls ORDER BY started_at DESC").all() as CallRow[];
    return rows.map(mapCall);
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM calls").get() as { n: number };
    return row.n;
  }

  ensure(input: { vapiCallId: string; callerNumber?: string | null; afterHours: boolean; now: Date }): CallRecord {
    const existing = this.getByVapiId(input.vapiCallId);
    if (existing) {
      if (input.callerNumber && !existing.callerNumber) {
        this.db.prepare("UPDATE calls SET caller_number = ? WHERE id = ?").run(input.callerNumber, existing.id);
        return { ...existing, callerNumber: input.callerNumber };
      }
      return existing;
    }
    const record: CallRecord = {
      id: newId("call"),
      vapiCallId: input.vapiCallId,
      callerNumber: input.callerNumber ?? null,
      callerName: null,
      startedAt: nowIso(input.now),
      endedAt: null,
      status: "in_progress",
      outcome: "in_progress",
      summary: null,
      transcript: null,
      endedReason: null,
      afterHours: input.afterHours,
      crmProvider: null,
      crmStatus: null,
      crmExternalId: null,
      crmError: null,
    };
    this.db
      .prepare(
        `INSERT INTO calls (
          id, vapi_call_id, caller_number, caller_name, started_at, ended_at, status, outcome,
          summary, transcript, ended_reason, after_hours, crm_provider, crm_status, crm_external_id, crm_error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.vapiCallId,
        record.callerNumber,
        record.callerName,
        record.startedAt,
        record.endedAt,
        record.status,
        record.outcome,
        record.summary,
        record.transcript,
        record.endedReason,
        record.afterHours ? 1 : 0,
        record.crmProvider,
        record.crmStatus,
        record.crmExternalId,
        record.crmError,
      );
    return record;
  }

  update(record: CallRecord): void {
    this.db
      .prepare(
        `UPDATE calls SET
          caller_number = ?, caller_name = ?, ended_at = ?, status = ?, outcome = ?,
          summary = ?, transcript = ?, ended_reason = ?, after_hours = ?,
          crm_provider = ?, crm_status = ?, crm_external_id = ?, crm_error = ?
         WHERE id = ?`,
      )
      .run(
        record.callerNumber,
        record.callerName,
        record.endedAt,
        record.status,
        record.outcome,
        record.summary,
        record.transcript,
        record.endedReason,
        record.afterHours ? 1 : 0,
        record.crmProvider,
        record.crmStatus,
        record.crmExternalId,
        record.crmError,
        record.id,
      );
  }

  findToolCall(callRowId: string, toolCallId: string): ToolCallRecord | null {
    const row = this.db
      .prepare("SELECT * FROM tool_calls WHERE call_row_id = ? AND tool_call_id = ?")
      .get(callRowId, toolCallId) as
      | {
          id: string;
          call_row_id: string;
          tool_call_id: string;
          name: string;
          arguments_json: string;
          result_json: string;
          created_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      callRowId: row.call_row_id,
      toolCallId: row.tool_call_id,
      name: row.name,
      arguments: JSON.parse(row.arguments_json) as unknown,
      result: JSON.parse(row.result_json) as unknown,
      createdAt: row.created_at,
    };
  }

  listToolCalls(callRowId: string): ToolCallRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM tool_calls WHERE call_row_id = ? ORDER BY created_at ASC, id ASC")
      .all(callRowId) as Array<{
      id: string;
      call_row_id: string;
      tool_call_id: string;
      name: string;
      arguments_json: string;
      result_json: string;
      created_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      callRowId: row.call_row_id,
      toolCallId: row.tool_call_id,
      name: row.name,
      arguments: JSON.parse(row.arguments_json) as unknown,
      result: JSON.parse(row.result_json) as unknown,
      createdAt: row.created_at,
    }));
  }

  saveToolCall(input: {
    callRowId: string;
    toolCallId: string;
    name: string;
    arguments: unknown;
    result: unknown;
    now: Date;
  }): ToolCallRecord {
    const record: ToolCallRecord = {
      id: newId("tool"),
      callRowId: input.callRowId,
      toolCallId: input.toolCallId,
      name: input.name,
      arguments: input.arguments,
      result: input.result,
      createdAt: nowIso(input.now),
    };
    this.db
      .prepare(
        `INSERT INTO tool_calls (id, call_row_id, tool_call_id, name, arguments_json, result_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.callRowId,
        record.toolCallId,
        record.name,
        JSON.stringify(record.arguments),
        JSON.stringify(record.result),
        record.createdAt,
      );
    return record;
  }

  getIdempotency(key: string): unknown | null {
    const row = this.db.prepare("SELECT body_json FROM idempotency WHERE key = ?").get(key) as
      | { body_json: string }
      | undefined;
    return row ? (JSON.parse(row.body_json) as unknown) : null;
  }

  insertIdempotency(key: string, body: unknown, now: Date): boolean {
    try {
      this.db
        .prepare("INSERT INTO idempotency (key, body_json, created_at) VALUES (?, ?, ?)")
        .run(key, JSON.stringify(body), nowIso(now));
      return true;
    } catch (error) {
      if (isSqliteConstraint(error)) return false;
      throw error;
    }
  }

  saveIdempotency(key: string, body: unknown, now: Date): void {
    this.db
      .prepare("INSERT OR REPLACE INTO idempotency (key, body_json, created_at) VALUES (?, ?, ?)")
      .run(key, JSON.stringify(body), nowIso(now));
  }

  deleteIdempotency(key: string): void {
    this.db.prepare("DELETE FROM idempotency WHERE key = ?").run(key);
  }

  getLead(callRowId: string): LeadRecord | null {
    const row = this.db.prepare("SELECT * FROM leads WHERE call_row_id = ?").get(callRowId) as
      | {
          id: string;
          call_row_id: string;
          name: string;
          phone: string;
          summary: string;
          outcome: string;
          appointment_id: string | null;
          interest: string | null;
          crm_provider: string | null;
          crm_status: string | null;
          crm_external_id: string | null;
          payload_json: string;
          created_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      callRowId: row.call_row_id,
      name: row.name,
      phone: row.phone,
      summary: row.summary,
      outcome: row.outcome,
      appointmentId: row.appointment_id,
      interest: row.interest,
      crmProvider: row.crm_provider,
      crmStatus: row.crm_status,
      crmExternalId: row.crm_external_id,
      payload: JSON.parse(row.payload_json) as unknown,
      createdAt: row.created_at,
    };
  }

  saveLead(lead: LeadRecord): void {
    this.db
      .prepare(
        `INSERT INTO leads (
          id, call_row_id, name, phone, summary, outcome, appointment_id, interest,
          crm_provider, crm_status, crm_external_id, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(call_row_id) DO UPDATE SET
          name = excluded.name,
          phone = excluded.phone,
          summary = excluded.summary,
          outcome = excluded.outcome,
          appointment_id = excluded.appointment_id,
          interest = excluded.interest,
          crm_provider = excluded.crm_provider,
          crm_status = excluded.crm_status,
          crm_external_id = excluded.crm_external_id,
          payload_json = excluded.payload_json`,
      )
      .run(
        lead.id,
        lead.callRowId,
        lead.name,
        lead.phone,
        lead.summary,
        lead.outcome,
        lead.appointmentId,
        lead.interest,
        lead.crmProvider,
        lead.crmStatus,
        lead.crmExternalId,
        JSON.stringify(lead.payload),
        lead.createdAt,
      );
  }
}

const OUTCOME_RANK: Record<string, number> = {
  in_progress: 0,
  completed: 1,
  faq: 2,
  wrong_number: 2,
  slot_unavailable: 3,
  cancelled: 4,
  rescheduled: 5,
  booked: 6,
  transferred: 7,
};

export function strongerOutcome(current: CallOutcome, next: CallOutcome): CallOutcome {
  const currentRank = OUTCOME_RANK[current] ?? 0;
  const nextRank = OUTCOME_RANK[next] ?? 0;
  return nextRank >= currentRank ? next : current;
}
