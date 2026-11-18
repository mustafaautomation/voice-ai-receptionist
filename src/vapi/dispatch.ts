import type { CalendarProvider } from "../calendar/types.js";
import { isOpenAt } from "../domain/rules.js";
import { isToolName, toolArgSchemas, type ToolName } from "./schemas.js";

export type ToolContext = {
  calendar: CalendarProvider;
  transferNumber: string;
  now: Date;
};

export async function executeTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
  if (!isToolName(name)) {
    return { ok: false, code: "unknown_tool", message: `Unknown tool ${name}.` };
  }
  const parsed = toolArgSchemas[name].safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      code: "invalid_arguments",
      message: parsed.error.issues.map((issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`).join("; "),
    };
  }
  try {
    return await runTool(name, parsed.data, ctx);
  } catch {
    // A calendar outage must still give the assistant something it can say.
    return {
      ok: false,
      code: "tool_error",
      message: "I cannot reach the calendar right now. I can transfer you to the front desk.",
    };
  }
}

async function runTool(name: ToolName, args: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
  switch (name) {
    case "check_availability":
      return ctx.calendar.checkAvailability(args as never);
    case "book_appointment":
      return ctx.calendar.book(args as never);
    case "reschedule_appointment":
      return ctx.calendar.reschedule(args as never);
    case "cancel_appointment":
      return ctx.calendar.cancel(args as never);
    case "transfer_to_human":
      return {
        ok: true,
        transfer: true,
        destination: ctx.transferNumber,
        mode: "warm-transfer",
        afterHours: !isOpenAt(ctx.now),
        reason: (args as { reason: string }).reason,
        message: "Transfer the caller to the front desk now.",
      };
    default:
      return { ok: false, code: "unknown_tool", message: `Unknown tool ${name}.` };
  }
}

export function outcomeForTool(name: string, result: unknown): string | null {
  const body = result as { ok?: boolean; code?: string };
  if (name === "transfer_to_human" && body.ok) return "transferred";
  if (name === "book_appointment" && body.ok) return "booked";
  if (name === "reschedule_appointment" && body.ok) return "rescheduled";
  if (name === "cancel_appointment" && body.ok) return "cancelled";
  if (name === "book_appointment" && body.code === "slot_taken") return "slot_unavailable";
  return null;
}
