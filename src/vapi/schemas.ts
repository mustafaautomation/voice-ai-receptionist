import { z } from "zod";
import { CLINIC } from "../clinic.js";

const jsonRecord = z.record(z.string(), z.unknown());

export const checkAvailabilityArgs = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  service: z.enum(CLINIC.services).optional(),
  days: z.number().int().min(1).max(14).optional(),
});

export const bookArgs = z.object({
  start: z.string().min(1),
  patientName: z.string().min(1).max(120),
  phone: z.string().min(7).max(32),
  service: z.enum(CLINIC.services),
  notes: z.string().max(500).optional(),
  email: z.string().email().optional(),
});

export const rescheduleArgs = z.object({
  appointmentId: z.string().min(1),
  start: z.string().min(1),
});

export const cancelArgs = z.object({
  appointmentId: z.string().min(1),
  reason: z.string().max(300).optional(),
});

export const transferArgs = z.object({
  reason: z.string().min(1).max(300),
});

export const toolArgSchemas = {
  check_availability: checkAvailabilityArgs,
  book_appointment: bookArgs,
  reschedule_appointment: rescheduleArgs,
  cancel_appointment: cancelArgs,
  transfer_to_human: transferArgs,
} as const;

export type ToolName = keyof typeof toolArgSchemas;

export function isToolName(value: string): value is ToolName {
  return value in toolArgSchemas;
}

const looseArgs = z.union([z.string(), jsonRecord]).optional();

export const vapiToolCallSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().optional(),
    function: z
      .object({
        name: z.string().optional(),
        arguments: looseArgs,
      })
      .optional(),
    name: z.string().optional(),
    parameters: jsonRecord.optional(),
    arguments: looseArgs,
  })
  .passthrough();

export const vapiMessageSchema = z
  .object({
    type: z.string(),
    call: z
      .object({
        id: z.string().min(1),
        customer: z
          .object({
            number: z.string().optional(),
          })
          .partial()
          .optional(),
      })
      .optional(),
    toolCallList: z.array(vapiToolCallSchema).optional(),
    toolCalls: z.array(vapiToolCallSchema).optional(),
    endedReason: z.string().optional(),
    summary: z.string().optional(),
    artifact: z
      .object({
        transcript: z.string().optional(),
        messages: z.array(z.unknown()).optional(),
        recordingUrl: z.string().optional(),
      })
      .partial()
      .optional(),
    analysis: z
      .object({
        summary: z.string().optional(),
        structuredData: jsonRecord.optional(),
        successEvaluation: z.string().optional(),
      })
      .partial()
      .optional(),
  })
  .passthrough();

export const vapiEnvelopeSchema = z.object({
  message: vapiMessageSchema,
});

export const directToolSchema = z.object({
  callId: z.string().min(1),
  toolCallId: z.string().min(1).optional(),
  callerNumber: z.string().optional(),
  arguments: jsonRecord.optional().default({}),
});

export type VapiEnvelope = z.infer<typeof vapiEnvelopeSchema>;
export type DirectToolBody = z.infer<typeof directToolSchema>;

export function readArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    throw new Error("Tool arguments must be a JSON object");
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return {};
}

export function toolCallName(call: z.infer<typeof vapiToolCallSchema>): string {
  return call.function?.name ?? call.name ?? "";
}

export function toolCallArguments(call: z.infer<typeof vapiToolCallSchema>): Record<string, unknown> {
  const raw = call.function?.arguments ?? call.arguments ?? call.parameters ?? {};
  return readArguments(raw);
}
