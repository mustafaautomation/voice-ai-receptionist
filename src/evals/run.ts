import { CLINIC } from "../clinic.js";
import { LocalCalendar } from "../calendar/local.js";
import { MemoryAppointmentStore } from "../calendar/memory.js";
import { executeTool } from "../vapi/dispatch.js";
import type { Scenario } from "./scenarios.js";
import { materializeArguments, ScriptedLlm } from "./scripted.js";

export type ToolTrace = { name: string; arguments: Record<string, unknown>; result: unknown };

export type ScenarioResult = {
  id: string;
  outcome: string;
  trace: ToolTrace[];
  bookedCount: number;
  appointments: Awaited<ReturnType<LocalCalendar["list"]>>;
};

export function deriveOutcome(trace: ToolTrace[]): string {
  const ok = (entry: ToolTrace) => (entry.result as { ok?: boolean }).ok === true;
  if (trace.some((entry) => entry.name === "transfer_to_human" && ok(entry))) return "transferred";
  if (trace.some((entry) => entry.name === "book_appointment" && ok(entry))) return "booked";
  if (trace.some((entry) => entry.name === "reschedule_appointment" && ok(entry))) return "rescheduled";
  if (trace.some((entry) => entry.name === "cancel_appointment" && ok(entry))) return "cancelled";
  const failedBook = [...trace].reverse().find((entry) => entry.name === "book_appointment" && !ok(entry));
  const code = (failedBook?.result as { code?: string } | undefined)?.code;
  if (code === "slot_taken") return "slot_taken";
  if (code === "outside_hours" || code === "closed" || code === "in_the_past") return "outside_hours";
  return "no_booking";
}

export async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
  const now = new Date(scenario.now);
  const store = new MemoryAppointmentStore(scenario.appointments ?? []);
  const calendar = new LocalCalendar("memory", store, () => now);
  const model = new ScriptedLlm(scenario);
  const trace: ToolTrace[] = [];
  for (const turn of model.turns()) {
    for (const action of turn.actions) {
      const args = materializeArguments(action, trace);
      const result = await executeTool(action.name, args, {
        calendar,
        transferNumber: CLINIC.transferNumber,
        now,
      });
      trace.push({ name: action.name, arguments: args, result });
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

export function scenarioPassed(scenario: Scenario, result: ScenarioResult): boolean {
  const names = result.trace.map((entry) => entry.name);
  if (names.join(",") !== scenario.expect.toolNames.join(",")) return false;
  if (result.outcome !== scenario.expect.outcome) return false;
  if (result.bookedCount !== scenario.expect.bookedCount) return false;
  if (scenario.expect.appointmentId) {
    const appointment = result.appointments.find((item) => item.id === scenario.expect.appointmentId);
    if (!appointment) return false;
    if (scenario.expect.appointmentStatus && appointment.status !== scenario.expect.appointmentStatus) return false;
    if (scenario.expect.startsAt && appointment.startsAt !== scenario.expect.startsAt) return false;
  }
  return true;
}
