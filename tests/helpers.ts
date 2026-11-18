import type { AppConfig } from "../src/config.js";
import { openDatabase, type SqliteDatabase } from "../src/db/database.js";

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 0,
    host: "127.0.0.1",
    nodeEnv: "test",
    logLevel: "silent",
    databasePath: ":memory:",
    calendarProvider: "sqlite",
    seedOnBoot: false,
    serveStatic: true,
    vapiWebhookSecret: "test-webhook-secret",
    vapiApiKey: "",
    publicBaseUrl: "http://localhost:3000",
    crmProvider: "memory",
    crmWebhookUrl: "",
    crmWebhookSecret: "",
    calcomApiKey: "",
    calcomEventTypeId: "",
    calcomApiBase: "https://api.cal.com",
    relayUrl: "",
    relayToken: "",
    relayNamespace: "brightside",
    transferNumber: "+13125550199",
    openaiApiKey: "",
    openaiModel: "gpt-4o-mini",
    ...overrides,
  };
}

export function memoryDb(): SqliteDatabase {
  return openDatabase(":memory:");
}

export const SECRET = "test-webhook-secret";
export const NOW = new Date("2026-11-18T15:00:00.000Z");
