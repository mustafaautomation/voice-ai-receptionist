import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import { LocalCalendar } from "./calendar/local.js";
import { MemoryAppointmentStore } from "./calendar/memory.js";
import { SqliteAppointmentStore } from "./calendar/sqlite.js";
import { SqliteCalendar } from "./calendar/sqlite-calendar.js";
import { CalcomCalendar } from "./calendar/calcom.js";
import { RelayCalendar } from "./calendar/relay.js";
import type { CalendarProvider } from "./calendar/types.js";
import { CallStore } from "./calls/store.js";
import type { AppConfig } from "./config.js";
import { GhlStubCrm } from "./crm/ghl-stub.js";
import { MemoryCrm } from "./crm/memory.js";
import type { CrmAdapter } from "./crm/types.js";
import { WebhookCrm } from "./crm/webhook.js";
import type { SqliteDatabase } from "./db/database.js";
import { registerDashboardRoutes } from "./dashboard/routes.js";
import { registerVapiRoutes } from "./vapi/routes.js";

export type AppDeps = {
  config: AppConfig;
  db: SqliteDatabase;
  calendar?: CalendarProvider;
  crm?: CrmAdapter;
  now?: () => Date;
};

export function createCalendar(config: AppConfig, db: SqliteDatabase, now: () => Date): CalendarProvider {
  if (config.calendarProvider === "memory") return new LocalCalendar("memory", new MemoryAppointmentStore(), now);
  if (config.calendarProvider === "calcom") {
    return new CalcomCalendar({
      apiKey: config.calcomApiKey,
      eventTypeId: config.calcomEventTypeId,
      baseUrl: config.calcomApiBase,
      now,
    });
  }
  if (config.calendarProvider === "relay") {
    return new RelayCalendar({
      baseUrl: config.relayUrl,
      token: config.relayToken,
      namespace: config.relayNamespace,
      now,
    });
  }
  return new SqliteCalendar(new SqliteAppointmentStore(db), now);
}

export function createCrm(config: AppConfig): CrmAdapter {
  if (config.crmProvider === "webhook") return new WebhookCrm(config.crmWebhookUrl, config.crmWebhookSecret || undefined);
  if (config.crmProvider === "ghl-stub") return new GhlStubCrm();
  return new MemoryCrm();
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const now = deps.now ?? (() => new Date());
  const calendar = deps.calendar ?? createCalendar(deps.config, deps.db, now);
  const crm = deps.crm ?? createCrm(deps.config);
  const calls = new CallStore(deps.db);
  const app = Fastify({
    logger:
      deps.config.logLevel === "silent"
        ? false
        : {
            level: deps.config.logLevel,
            redact: ["req.headers.x-vapi-secret", "req.headers.authorization"],
          },
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        scriptSrc: ["'self'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
  });
  if (deps.config.serveStatic) {
    // Loaded lazily: on Vercel the CDN serves public/ and this plugin is skipped.
    const { default: fastifyStatic } = await import("@fastify/static");
    await app.register(fastifyStatic, {
      root: join(process.cwd(), "public", "assets"),
      prefix: "/assets/",
    });
  }

  app.get("/health", async () => ({ ok: true, clinic: "Brightside Dental" }));

  await registerDashboardRoutes(app, { calls, calendar });
  await registerVapiRoutes(app, {
    secret: deps.config.vapiWebhookSecret,
    calendar,
    calls,
    crm,
    transferNumber: deps.config.transferNumber,
    now,
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    return reply.code(500).send({ error: "internal_error" });
  });

  return app;
}
