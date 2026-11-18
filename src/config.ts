import { existsSync } from "node:fs";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().min(1).default("0.0.0.0"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_PATH: z.string().min(1).default("./data/clinic.sqlite"),
  CALENDAR_PROVIDER: z.enum(["sqlite", "memory", "calcom", "relay"]).default("sqlite"),
  SEED_ON_BOOT: z.enum(["true", "false"]).default("true"),
  SERVE_STATIC: z.enum(["true", "false"]).default("true"),
  VAPI_WEBHOOK_SECRET: z.string().min(8),
  VAPI_API_KEY: z.string().optional().default(""),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000"),
  CRM_PROVIDER: z.enum(["memory", "webhook", "ghl-stub"]).default("memory"),
  CRM_WEBHOOK_URL: z.string().url().optional().or(z.literal("")).default(""),
  CRM_WEBHOOK_SECRET: z.string().optional().default(""),
  CALCOM_API_KEY: z.string().optional().default(""),
  CALCOM_EVENT_TYPE_ID: z.string().optional().default(""),
  CALCOM_API_BASE: z.string().url().default("https://api.cal.com"),
  RELAY_URL: z.string().url().optional().or(z.literal("")).default(""),
  RELAY_TOKEN: z.string().optional().default(""),
  RELAY_NAMESPACE: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).default("brightside"),
  VAPI_ORG_ID: z.string().optional().default(""),
  VAPI_PUBLIC_KEY: z.string().optional().default(""),
  VAPI_ASSISTANT_ID: z.string().optional().default(""),
  WEB_CALL_ORIGINS: z.string().optional().default(""),
  WEB_CALL_LIMIT_PER_VISITOR: z.coerce.number().int().min(1).max(100).default(3),
  WEB_CALL_LIMIT_PER_DAY: z.coerce.number().int().min(1).max(10000).default(40),
  WEB_CALL_TOKEN_TTL_SECONDS: z.coerce.number().int().min(10).max(600).default(30),
  TRUST_PROXY_HEADERS: z.enum(["true", "false"]).default("false"),
  TRANSFER_NUMBER: z.string().min(8).default("+13125550199"),
  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
});

export type AppConfig = {
  port: number;
  host: string;
  nodeEnv: "development" | "test" | "production";
  logLevel: string;
  databasePath: string;
  calendarProvider: "sqlite" | "memory" | "calcom" | "relay";
  seedOnBoot: boolean;
  serveStatic: boolean;
  vapiWebhookSecret: string;
  vapiApiKey: string;
  publicBaseUrl: string;
  crmProvider: "memory" | "webhook" | "ghl-stub";
  crmWebhookUrl: string;
  crmWebhookSecret: string;
  calcomApiKey: string;
  calcomEventTypeId: string;
  calcomApiBase: string;
  relayUrl: string;
  relayToken: string;
  relayNamespace: string;
  vapiOrgId: string;
  vapiPublicKey: string;
  vapiAssistantId: string;
  webCallOrigins: string[];
  webCallLimitPerVisitor: number;
  webCallLimitPerDay: number;
  webCallTokenTtlSeconds: number;
  trustProxyHeaders: boolean;
  transferNumber: string;
  openaiApiKey: string;
  openaiModel: string;
};

export function loadEnvFile(): void {
  if (existsSync(".env")) loadDotenv();
}

export function parseConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  const value = parsed.data;
  if (value.CALENDAR_PROVIDER === "calcom" && (!value.CALCOM_API_KEY || !value.CALCOM_EVENT_TYPE_ID)) {
    throw new Error("CALCOM_API_KEY and CALCOM_EVENT_TYPE_ID are required when CALENDAR_PROVIDER=calcom");
  }
  if (value.CALENDAR_PROVIDER === "relay" && (!value.RELAY_URL || !value.RELAY_TOKEN)) {
    throw new Error("RELAY_URL and RELAY_TOKEN are required when CALENDAR_PROVIDER=relay");
  }
  if (value.CRM_PROVIDER === "webhook" && !value.CRM_WEBHOOK_URL) {
    throw new Error("CRM_WEBHOOK_URL is required when CRM_PROVIDER=webhook");
  }
  return {
    port: value.PORT,
    host: value.HOST,
    nodeEnv: value.NODE_ENV,
    logLevel: value.LOG_LEVEL,
    databasePath: value.DATABASE_PATH,
    calendarProvider: value.CALENDAR_PROVIDER,
    seedOnBoot: value.SEED_ON_BOOT === "true",
    serveStatic: value.SERVE_STATIC === "true",
    vapiWebhookSecret: value.VAPI_WEBHOOK_SECRET,
    vapiApiKey: value.VAPI_API_KEY,
    publicBaseUrl: value.PUBLIC_BASE_URL.replace(/\/$/, ""),
    crmProvider: value.CRM_PROVIDER,
    crmWebhookUrl: value.CRM_WEBHOOK_URL,
    crmWebhookSecret: value.CRM_WEBHOOK_SECRET,
    calcomApiKey: value.CALCOM_API_KEY,
    calcomEventTypeId: value.CALCOM_EVENT_TYPE_ID,
    calcomApiBase: value.CALCOM_API_BASE,
    relayUrl: value.RELAY_URL,
    relayToken: value.RELAY_TOKEN,
    relayNamespace: value.RELAY_NAMESPACE,
    vapiOrgId: value.VAPI_ORG_ID,
    vapiPublicKey: value.VAPI_PUBLIC_KEY,
    vapiAssistantId: value.VAPI_ASSISTANT_ID,
    webCallOrigins: (value.WEB_CALL_ORIGINS || value.PUBLIC_BASE_URL)
      .split(",")
      .map((origin) => origin.trim().replace(/\/$/, ""))
      .filter(Boolean),
    webCallLimitPerVisitor: value.WEB_CALL_LIMIT_PER_VISITOR,
    webCallLimitPerDay: value.WEB_CALL_LIMIT_PER_DAY,
    webCallTokenTtlSeconds: value.WEB_CALL_TOKEN_TTL_SECONDS,
    trustProxyHeaders: value.TRUST_PROXY_HEADERS === "true",
    transferNumber: value.TRANSFER_NUMBER,
    openaiApiKey: value.OPENAI_API_KEY,
    openaiModel: value.OPENAI_MODEL,
  };
}

export function loadConfig(): AppConfig {
  loadEnvFile();
  return parseConfig(process.env);
}
