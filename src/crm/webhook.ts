import type { CrmAdapter, CrmPushResult, Lead } from "./types.js";

type FetchLike = typeof fetch;

export class WebhookCrm implements CrmAdapter {
  readonly name = "webhook" as const;

  constructor(
    private readonly url: string,
    private readonly secret: string | undefined,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async pushLead(lead: Lead): Promise<CrmPushResult> {
    try {
      const response = await this.fetchImpl(this.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.secret ? { "x-webhook-secret": this.secret } : {}),
        },
        body: JSON.stringify({
          source: "brightside-dental-receptionist",
          event: "call.completed",
          lead,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        return { ok: false, provider: "webhook", error: `Webhook responded ${response.status}` };
      }
      return { ok: true, provider: "webhook", externalId: response.headers.get("x-request-id") ?? undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Webhook request failed";
      return { ok: false, provider: "webhook", error: message };
    }
  }
}
