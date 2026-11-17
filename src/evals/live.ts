import { CLINIC } from "../clinic.js";
import { LocalCalendar } from "../calendar/local.js";
import { MemoryAppointmentStore } from "../calendar/memory.js";
import { buildTools, SYSTEM_PROMPT } from "../vapi/assistant.js";
import { executeTool } from "../vapi/dispatch.js";
import type { Scenario } from "./scenarios.js";
import { deriveOutcome, type ScenarioResult, type ToolTrace } from "./run.js";

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: unknown;
  tool_call_id?: string;
};

type FetchLike = typeof fetch;

type Completion = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
};

/**
 * Optional real-model loop. CI does not call this. It still asserts on tool
 * calls and stored appointments, not on the wording of the reply.
 */
export async function runLiveScenario(
  scenario: Scenario,
  options: { apiKey: string; model: string; fetchImpl?: FetchLike; baseUrl?: string },
): Promise<ScenarioResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = new Date(scenario.now);
  const calendar = new LocalCalendar("memory", new MemoryAppointmentStore(scenario.appointments ?? []), () => now);
  const tools = buildTools(options.baseUrl ?? "http://localhost:3000").map((tool) => ({
    type: "function" as const,
    function: tool.function,
  }));
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "system",
      content: `The current time is ${scenario.now}. Use tools for any schedule change. Do not invent times.`,
    },
  ];
  const trace: ToolTrace[] = [];

  for (const turn of scenario.turns) {
    messages.push({ role: "user", content: turn.user });
    for (let step = 0; step < 6; step += 1) {
      const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: options.model, temperature: 0, messages, tools }),
      });
      if (!response.ok) throw new Error(`OpenAI request failed (${response.status})`);
      const body = (await response.json()) as Completion;
      const message = body.choices?.[0]?.message;
      const toolCalls = message?.tool_calls ?? [];
      messages.push({ role: "assistant", content: message?.content ?? null, tool_calls: toolCalls });
      if (toolCalls.length === 0) break;
      for (const toolCall of toolCalls) {
        const name = toolCall.function?.name ?? "";
        const args = JSON.parse(toolCall.function?.arguments || "{}") as Record<string, unknown>;
        const result = await executeTool(name, args, {
          calendar,
          transferNumber: CLINIC.transferNumber,
          now,
        });
        trace.push({ name, arguments: args, result });
        messages.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(result) });
      }
    }
  }

  const appointments = await calendar.list();
  return {
    id: scenario.id,
    outcome: deriveOutcome(trace),
    trace,
    bookedCount: appointments.filter((appointment) => appointment.status === "booked").length,
    appointments,
  };
}
