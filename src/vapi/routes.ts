import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { DateTime } from "luxon";
import { z } from "zod";
import type { CalendarProvider } from "../calendar/types.js";
import { CallStore, strongerOutcome, type CallOutcome, type CallRecord, type ToolCallRecord } from "../calls/store.js";
import type { CrmAdapter, Lead } from "../crm/types.js";
import { isSqliteConstraint } from "../db/database.js";
import { newId } from "../domain/ids.js";
import { isOpenAt } from "../domain/rules.js";
import { toUtcIso } from "../domain/time.js";
import { verifyVapiSecret } from "./auth.js";
import { executeTool, outcomeForTool } from "./dispatch.js";
import {
  directToolSchema,
  isToolName,
  toolCallArguments,
  toolCallName,
  vapiEnvelopeSchema,
  type VapiEnvelope,
} from "./schemas.js";

export type VapiRouteDeps = {
  secret: string;
  calendar: CalendarProvider;
  calls: CallStore;
  crm: CrmAdapter;
  transferNumber: string;
  now: () => Date;
};

type NormalizedCall = {
  callId: string;
  toolCallId: string;
  callerNumber?: string;
  name: string;
  args: Record<string, unknown>;
};

export async function registerVapiRoutes(app: FastifyInstance, deps: VapiRouteDeps): Promise<void> {
  app.post("/vapi/webhook", async (request, reply) => {
    if (!authorize(request, reply, deps.secret)) return;
    const parsed = vapiEnvelopeSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    return handleEnvelope(parsed.data, reply, deps);
  });

  app.post("/vapi/tools/:toolName", async (request, reply) => {
    if (!authorize(request, reply, deps.secret)) return;
    const params = request.params as { toolName?: string };
    const toolName = params.toolName ?? "";
    if (!isToolName(toolName)) {
      return reply.code(404).send({ error: "unknown_tool", message: `Unknown tool ${toolName}.` });
    }
    const envelope = vapiEnvelopeSchema.safeParse(request.body);
    if (envelope.success) {
      const message = envelope.data.message;
      if (message.type !== "tool-calls" && message.type !== "function-call") {
        return reply.code(400).send({
          error: "invalid_payload",
          issues: [{ path: "message.type", message: "Tool URL expects a tool-calls message." }],
        });
      }
      return handleEnvelope(envelope.data, reply, deps, toolName);
    }
    const direct = directToolSchema.safeParse(request.body);
    if (!direct.success) return invalid(reply, direct.error);
    const normalized: NormalizedCall = {
      callId: direct.data.callId,
      toolCallId: direct.data.toolCallId ?? `direct_${toolName}`,
      callerNumber: direct.data.callerNumber,
      name: toolName,
      args: direct.data.arguments,
    };
    const result = await runOne(normalized, deps);
    return reply.code(200).send({ ok: true, result });
  });
}

function authorize(request: FastifyRequest, reply: FastifyReply, secret: string): boolean {
  const header = request.headers["x-vapi-secret"];
  if (!verifyVapiSecret(header, secret)) {
    void reply.code(401).send({ error: "unauthorized" });
    return false;
  }
  return true;
}

function invalid(reply: FastifyReply, error: z.ZodError): FastifyReply {
  return reply.code(400).send({
    error: "invalid_payload",
    issues: error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
}

async function handleEnvelope(
  envelope: VapiEnvelope,
  reply: FastifyReply,
  deps: VapiRouteDeps,
  expectedTool?: string,
): Promise<FastifyReply> {
  const type = envelope.message.type;
  if (type === "end-of-call-report") return handleEndOfCall(envelope, reply, deps);
  if (type === "tool-calls" || type === "function-call") {
    return handleToolCalls(envelope, reply, deps, expectedTool);
  }
  return reply.code(200).send({ ok: true, ignored: type });
}

async function handleToolCalls(
  envelope: VapiEnvelope,
  reply: FastifyReply,
  deps: VapiRouteDeps,
  expectedTool?: string,
): Promise<FastifyReply> {
  const callId = envelope.message.call?.id;
  if (!callId) {
    return reply.code(400).send({
      error: "invalid_payload",
      issues: [{ path: "message.call.id", message: "Required" }],
    });
  }
  const listed = envelope.message.toolCallList ?? envelope.message.toolCalls ?? [];
  if (listed.length === 0) {
    return reply.code(400).send({
      error: "invalid_payload",
      issues: [{ path: "message.toolCallList", message: "At least one tool call is required." }],
    });
  }
  const results = [];
  for (const toolCall of listed) {
    let args: Record<string, unknown>;
    try {
      args = toolCallArguments(toolCall);
    } catch {
      results.push({
        toolCallId: toolCall.id,
        result: { ok: false, code: "invalid_arguments", message: "Tool arguments must be a JSON object." },
      });
      continue;
    }
    const name = toolCallName(toolCall);
    if (expectedTool && name && name !== expectedTool) {
      results.push({
        toolCallId: toolCall.id,
        result: { ok: false, code: "tool_mismatch", message: `This URL only accepts ${expectedTool}.` },
      });
      continue;
    }
    const result = await runOne(
      {
        callId,
        toolCallId: toolCall.id,
        callerNumber: envelope.message.call?.customer?.number,
        name: name || expectedTool || "",
        args,
      },
      deps,
    );
    results.push({ toolCallId: toolCall.id, result });
  }
  return reply.code(200).send({ results });
}

async function runOne(call: NormalizedCall, deps: VapiRouteDeps): Promise<unknown> {
  const now = deps.now();
  const record = deps.calls.ensure({
    vapiCallId: call.callId,
    callerNumber: call.callerNumber,
    afterHours: !isOpenAt(now),
    now,
  });
  const cached = deps.calls.findToolCall(record.id, call.toolCallId);
  if (cached) return cached.result;

  const result = await executeTool(call.name, call.args, {
    calendar: deps.calendar,
    transferNumber: deps.transferNumber,
    now,
  });
  try {
    deps.calls.saveToolCall({
      callRowId: record.id,
      toolCallId: call.toolCallId,
      name: call.name,
      arguments: call.args,
      result,
      now,
    });
  } catch (error) {
    if (!isSqliteConstraint(error)) throw error;
    const raced = deps.calls.findToolCall(record.id, call.toolCallId);
    if (raced) return raced.result;
    throw error;
  }
  applyOutcome(deps.calls, record, call.name, call.args, result);
  return result;
}

function applyOutcome(
  calls: CallStore,
  record: CallRecord,
  name: string,
  args: Record<string, unknown>,
  result: unknown,
): void {
  const current = calls.getById(record.id) ?? record;
  const next = outcomeForTool(name, result);
  const body = result as { ok?: boolean; appointment?: { patientName?: string; phone?: string } };
  let callerName = current.callerName;
  let callerNumber = current.callerNumber;
  if (body.ok && body.appointment?.patientName) callerName = body.appointment.patientName;
  if (body.ok && body.appointment?.phone) callerNumber = body.appointment.phone;
  if (!callerName && typeof args.patientName === "string") callerName = args.patientName;
  const outcome = next ? strongerOutcome(current.outcome, next as CallOutcome) : current.outcome;
  if (outcome === current.outcome && callerName === current.callerName && callerNumber === current.callerNumber) return;
  calls.update({ ...current, callerName, callerNumber, outcome });
}

async function handleEndOfCall(envelope: VapiEnvelope, reply: FastifyReply, deps: VapiRouteDeps): Promise<FastifyReply> {
  const vapiCallId = envelope.message.call?.id;
  if (!vapiCallId) {
    return reply.code(400).send({
      error: "invalid_payload",
      issues: [{ path: "message.call.id", message: "Required" }],
    });
  }
  const key = `eoc:${vapiCallId}`;
  const cached = deps.calls.getIdempotency(key);
  if (isFinalBody(cached)) return reply.code(200).send(cached);

  const now = deps.now();
  const inserted = deps.calls.insertIdempotency(key, { pending: true }, now);
  if (!inserted) {
    const again = deps.calls.getIdempotency(key);
    if (isFinalBody(again)) return reply.code(200).send(again);
    return reply.code(409).send({ error: "in_progress" });
  }

  try {
    const record = deps.calls.ensure({
      vapiCallId,
      callerNumber: envelope.message.call?.customer?.number,
      afterHours: !isOpenAt(now),
      now,
    });
    const tools = deps.calls.listToolCalls(record.id);
    const summary = envelope.message.analysis?.summary || envelope.message.summary || record.summary || "";
    const transcript =
      envelope.message.artifact?.transcript ||
      transcriptFromMessages(envelope.message.artifact?.messages ?? []) ||
      record.transcript ||
      "";
    const intent = envelope.message.analysis?.structuredData?.intent;
    let outcome = record.outcome;
    if ((outcome === "in_progress" || outcome === "completed") && (intent === "faq" || intent === "wrong_number")) {
      outcome = intent;
    }
    if (outcome === "in_progress") outcome = "completed";

    const leadInput = buildLead(record, tools, summary, outcome, intent);
    const existingLead = deps.calls.getLead(record.id);
    const crmResult =
      existingLead?.crmStatus === "pushed"
        ? {
            ok: true,
            provider: (existingLead.crmProvider ?? deps.crm.name) as "memory" | "webhook" | "ghl-stub",
            externalId: existingLead.crmExternalId ?? undefined,
          }
        : await deps.crm.pushLead(leadInput);

    const endedAt = toUtcIso(DateTime.fromJSDate(now, { zone: "utc" }));
    const fresh = deps.calls.getById(record.id);
    if (!fresh) throw new Error(`Call ${record.id} was not stored`);
    deps.calls.update({
      ...fresh,
      callerName: leadInput.name === "Unknown caller" ? record.callerName : leadInput.name,
      callerNumber: leadInput.phone === "unknown" ? record.callerNumber : leadInput.phone,
      status: "completed",
      outcome,
      summary,
      transcript: transcript.slice(0, 50_000),
      endedReason: envelope.message.endedReason ?? null,
      endedAt,
      crmProvider: deps.crm.name,
      crmStatus: crmResult.ok ? "pushed" : "failed",
      crmExternalId: crmResult.externalId ?? null,
      crmError: crmResult.ok ? null : (crmResult.error ?? "push failed"),
    });

    const leadId = existingLead?.id ?? newId("lead");
    deps.calls.saveLead({
      id: leadId,
      callRowId: record.id,
      name: leadInput.name,
      phone: leadInput.phone,
      summary: leadInput.summary,
      outcome: leadInput.outcome,
      appointmentId: leadInput.appointmentId ?? null,
      interest: leadInput.interest ?? null,
      crmProvider: deps.crm.name,
      crmStatus: crmResult.ok ? "pushed" : "failed",
      crmExternalId: crmResult.externalId ?? null,
      payload: leadInput,
      createdAt: existingLead?.createdAt ?? endedAt,
    });

    if (!crmResult.ok) {
      deps.calls.deleteIdempotency(key);
      return reply.code(502).send({ error: "crm_failed", callId: record.id });
    }

    const body = { ok: true, callId: record.id, leadId, outcome, crmStatus: "pushed" };
    deps.calls.saveIdempotency(key, body, now);
    return reply.code(200).send(body);
  } catch (error) {
    deps.calls.deleteIdempotency(key);
    throw error;
  }
}

function isFinalBody(value: unknown): value is { ok: true; callId: string } {
  return Boolean(value && typeof value === "object" && "ok" in value && (value as { ok?: boolean }).ok === true && !("pending" in (value as object)));
}

function transcriptFromMessages(messages: unknown[]): string {
  const lines: string[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const row = message as { role?: string; message?: string; content?: string };
    const text = typeof row.message === "string" ? row.message : typeof row.content === "string" ? row.content : "";
    if (!text) continue;
    lines.push(`${row.role ?? "unknown"}: ${text}`);
  }
  return lines.join("\n");
}

function buildLead(
  record: CallRecord,
  tools: ToolCallRecord[],
  summary: string,
  outcome: string,
  intent: unknown,
): Lead {
  const successful = [...tools].reverse().find((tool) => {
    const result = tool.result as { ok?: boolean; appointment?: { id?: string; patientName?: string; phone?: string } };
    return result.ok === true && (tool.name === "book_appointment" || tool.name === "reschedule_appointment");
  });
  const appointment = (successful?.result as { appointment?: { id?: string; patientName?: string; phone?: string } } | undefined)
    ?.appointment;
  const args = (successful?.arguments ?? {}) as { patientName?: string; phone?: string; service?: string };
  const name = appointment?.patientName || args.patientName || record.callerName || "Unknown caller";
  const phone = appointment?.phone || args.phone || record.callerNumber || "unknown";
  return {
    callId: record.vapiCallId,
    name,
    phone,
    summary: summary || "No summary provided.",
    outcome,
    appointmentId: appointment?.id,
    interest: typeof intent === "string" ? intent : args.service,
  };
}
