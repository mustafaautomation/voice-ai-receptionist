import type { CrmAdapter, CrmPushResult, Lead } from "./types.js";

export class MemoryCrm implements CrmAdapter {
  readonly name = "memory" as const;
  readonly pushed: Lead[] = [];

  pushLead(lead: Lead): Promise<CrmPushResult> {
    this.pushed.push({ ...lead });
    return Promise.resolve({ ok: true, provider: "memory", externalId: `mem_${lead.callId}` });
  }
}
