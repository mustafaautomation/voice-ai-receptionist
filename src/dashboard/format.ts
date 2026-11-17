import type { CallOutcome, CallRecord } from "../calls/store.js";

export function outcomeLabel(outcome: CallOutcome | string): string {
  switch (outcome) {
    case "in_progress":
      return "In progress";
    case "booked":
      return "Booked";
    case "rescheduled":
      return "Rescheduled";
    case "cancelled":
      return "Cancelled";
    case "transferred":
      return "Transferred";
    case "slot_unavailable":
      return "Slot unavailable";
    case "completed":
      return "Completed";
    case "wrong_number":
      return "Wrong number";
    case "faq":
      return "FAQ";
    default:
      return outcome;
  }
}

export function filterCalls(calls: CallRecord[], query: string): CallRecord[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return calls;
  return calls.filter((call) => {
    const haystack = [call.callerName, call.callerNumber, call.summary, call.transcript, call.outcome, call.vapiCallId]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}
