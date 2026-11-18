import { CLINIC, SERVICE_LABELS } from "../clinic.js";

export const SYSTEM_PROMPT = `You are the phone receptionist for ${CLINIC.name}, a fictional dental clinic at ${CLINIC.address}. The clinic phone is ${CLINIC.phoneDisplay}. Timezone is ${CLINIC.timezone} (Central Time). Today is {{"now" | date: "%A, %B %d, %Y, %I:%M %p", "America/Chicago"}} Central Time.

Hours:
- Monday to Friday, 8:00 AM to 5:00 PM
- Saturday, 9:00 AM to 1:00 PM
- Sunday, closed

Services: ${CLINIC.services.map((id) => SERVICE_LABELS[id]).join(", ")}. Each visit is ${CLINIC.slotMinutes} minutes.

How to handle the call:
- Speak in short sentences. Ask one question at a time.
- Never invent appointment times. Availability, booking, rescheduling, and cancellation must go through the tools.
- Before booking, confirm the caller's name, a callback number, the service, and the exact slot. Then call book_appointment.
- Read times back in Central Time, using the slot label from the tool.
- Cancellations and reschedules need ${CLINIC.cancellationWindowHours} hours notice. If a tool refuses, explain the reason in the tool result and offer transfer_to_human.
- Outside opening hours, say the clinic is closed, then use check_availability for the next open slots. Emergencies can be transferred.
- If the caller is angry, asks for a person, or the topic is billing, insurance benefits, or clinical advice, call transfer_to_human. Do not give medical advice.
- If they have the wrong number, apologize briefly and end the call. Do not book.
- New patients are accepted. For a detailed insurance check, transfer to the front desk.
- Do not claim to be a human. If asked, say you are the virtual front desk.`;

export type AssistantTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
  server: VapiServer;
};

/** Vapi sends these headers on every request to the server, so the API can check x-vapi-secret. */
export type VapiServer = { url: string; headers?: Record<string, string> };

function serverFor(url: string, secret?: string): VapiServer {
  return secret ? { url, headers: { "x-vapi-secret": secret } } : { url };
}

const objectSchema = (properties: Record<string, unknown>, required: string[]): Record<string, unknown> => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export function buildTools(publicBaseUrl: string, secret?: string): AssistantTool[] {
  const base = publicBaseUrl.replace(/\/$/, "");
  const tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }> = [
    {
      name: "check_availability",
      description: "List open appointment slots. Use before offering or confirming a time. Pass a YYYY-MM-DD date in the clinic timezone, or omit it to search the next 7 days.",
      parameters: objectSchema(
        {
          date: { type: "string", description: "Clinic-local date YYYY-MM-DD" },
          service: { type: "string", enum: [...CLINIC.services] },
          days: { type: "integer", minimum: 1, maximum: 14 },
        },
        [],
      ),
    },
    {
      name: "book_appointment",
      description: "Book a slot that check_availability returned. Confirm name, phone, service, and start time with the caller first.",
      parameters: objectSchema(
        {
          start: { type: "string", description: "Slot start ISO timestamp from check_availability" },
          patientName: { type: "string" },
          phone: { type: "string" },
          service: { type: "string", enum: [...CLINIC.services] },
          notes: { type: "string" },
          email: { type: "string" },
        },
        ["start", "patientName", "phone", "service"],
      ),
    },
    {
      name: "reschedule_appointment",
      description: "Move an existing appointment to a new open slot. Requires 24 hours notice.",
      parameters: objectSchema(
        {
          appointmentId: { type: "string" },
          start: { type: "string", description: "New slot start ISO timestamp" },
        },
        ["appointmentId", "start"],
      ),
    },
    {
      name: "cancel_appointment",
      description: "Cancel an existing appointment. Requires 24 hours notice.",
      parameters: objectSchema(
        {
          appointmentId: { type: "string" },
          reason: { type: "string" },
        },
        ["appointmentId"],
      ),
    },
    {
      name: "transfer_to_human",
      description: "Transfer the caller to the front desk. Use for angry callers, billing, insurance, clinical questions, emergencies, or any request for a person.",
      parameters: objectSchema({ reason: { type: "string" } }, ["reason"]),
    },
  ];
  return tools.map((tool) => ({
    type: "function" as const,
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    server: serverFor(`${base}/vapi/tools/${tool.name}`, secret),
  }));
}

export type VapiAssistantPayload = {
  name: string;
  firstMessage: string;
  server: VapiServer;
  serverMessages: string[];
  endCallMessage: string;
  silenceTimeoutSeconds: number;
  maxDurationSeconds: number;
  model: {
    provider: "openai";
    model: string;
    temperature: number;
    messages: Array<{ role: "system"; content: string }>;
    tools: AssistantTool[];
  };
  voice: { provider: "vapi"; voiceId: string };
  transcriber: { provider: "deepgram"; model: string; language: "en" };
};

export function buildAssistant(input: {
  publicBaseUrl: string;
  serverUrlSecret?: string;
  model?: string;
}): VapiAssistantPayload {
  const payload: VapiAssistantPayload = {
    name: `${CLINIC.name} Receptionist`,
    firstMessage: `Thank you for calling ${CLINIC.name}. I can share our hours, or book, move, and cancel a visit. What do you need?`,
    server: serverFor(`${input.publicBaseUrl.replace(/\/$/, "")}/vapi/webhook`, input.serverUrlSecret),
    serverMessages: ["end-of-call-report"],
    endCallMessage: `Thank you for calling ${CLINIC.name}. Goodbye.`,
    silenceTimeoutSeconds: 30,
    // Short cap: the public demo runs on free Vapi credits.
    maxDurationSeconds: 240,
    model: {
      provider: "openai",
      model: input.model ?? "gpt-4o-mini",
      temperature: 0.3,
      messages: [{ role: "system", content: SYSTEM_PROMPT }],
      tools: buildTools(input.publicBaseUrl, input.serverUrlSecret),
    },
    voice: { provider: "vapi", voiceId: "Elliot" },
    transcriber: { provider: "deepgram", model: "nova-2", language: "en" },
  };
  return payload;
}
