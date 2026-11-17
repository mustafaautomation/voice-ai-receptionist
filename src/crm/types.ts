export type Lead = {
  callId: string;
  name: string;
  phone: string;
  summary: string;
  outcome: string;
  appointmentId?: string;
  interest?: string;
};

export type CrmPushResult = {
  ok: boolean;
  provider: "memory" | "webhook" | "ghl-stub";
  externalId?: string;
  error?: string;
  stub?: boolean;
};

export interface CrmAdapter {
  readonly name: "memory" | "webhook" | "ghl-stub";
  pushLead(lead: Lead): Promise<CrmPushResult>;
}
