import type { Scenario, ScriptAction } from "./scenarios.js";

/** Deterministic stand-in for the model. It replays the scenario script and does not call a network LLM. */
export class ScriptedLlm {
  constructor(private readonly scenario: Scenario) {}

  turns(): Scenario["turns"] {
    return this.scenario.turns;
  }
}

export function materializeArguments(action: ScriptAction, trace: Array<{ name: string; result: unknown }>): Record<string, unknown> {
  if ("pick" in action) {
    const start = firstSlot(trace);
    return {
      start,
      patientName: action.patientName,
      phone: action.phone,
      service: action.service,
    };
  }
  return action.arguments;
}

function firstSlot(trace: Array<{ name: string; result: unknown }>): string {
  const checks = trace.filter((entry) => entry.name === "check_availability");
  const latest = checks[checks.length - 1];
  const dates = (latest?.result as { dates?: Array<{ slots?: Array<{ start?: string }> }> } | undefined)?.dates ?? [];
  for (const date of dates) {
    const start = date.slots?.[0]?.start;
    if (start) return start;
  }
  throw new Error("Scripted model expected an open slot and none was returned");
}
