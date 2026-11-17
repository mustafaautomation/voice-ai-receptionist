import { newId } from "../domain/ids.js";
import type { CrmAdapter, CrmPushResult, Lead } from "./types.js";

/**
 * STUB. This is not a GoHighLevel client and it does not call the GHL API.
 * It only shapes a lead into the contact payload a GHL inbound webhook
 * typically accepts, then returns a fake id. Replace it with a real client
 * if you have GHL credentials.
 */
export function toGhlContactPayload(lead: Lead): Record<string, unknown> {
  const parts = lead.name.trim().split(/\s+/);
  const firstName = parts[0] || "Caller";
  const lastName = parts.slice(1).join(" ") || "Unknown";
  return {
    firstName,
    lastName,
    phone: lead.phone,
    source: "AI Receptionist",
    tags: ["brightside-dental", "phone-lead"],
    customFields: [
      { key: "call_summary", value: lead.summary },
      { key: "call_outcome", value: lead.outcome },
      { key: "call_id", value: lead.callId },
      ...(lead.appointmentId ? [{ key: "appointment_id", value: lead.appointmentId }] : []),
    ],
  };
}

export class GhlStubCrm implements CrmAdapter {
  readonly name = "ghl-stub" as const;
  readonly payloads: Record<string, unknown>[] = [];

  pushLead(lead: Lead): Promise<CrmPushResult> {
    const payload = toGhlContactPayload(lead);
    this.payloads.push(payload);
    return Promise.resolve({
      ok: true,
      provider: "ghl-stub",
      externalId: newId("ghl_stub"),
      stub: true,
    });
  }
}
