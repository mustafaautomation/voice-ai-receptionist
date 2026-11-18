import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { CalendarProvider } from "../calendar/types.js";
import type { CallStore } from "../calls/store.js";
import { filterCalls } from "./format.js";
import { renderAppointmentsPage, renderCallDetail, renderCallsPage, renderNotFound } from "./render.js";

let landing: Promise<string> | undefined;

export async function registerDashboardRoutes(
  app: FastifyInstance,
  deps: { calls: CallStore; calendar: CalendarProvider },
): Promise<void> {
  // Landing page with the browser call button. It loads the Vapi web SDK from a CDN,
  // so it opts out of the strict CSP the dashboard pages use.
  app.get("/", async (_request, reply) => {
    landing ??= readFile(join(process.cwd(), "public", "index.html"), "utf8");
    reply.removeHeader("content-security-policy");
    return reply.type("text/html").send(await landing);
  });

  app.get("/calls", async (request, reply) => {
    const query = typeof (request.query as { q?: unknown }).q === "string" ? (request.query as { q: string }).q : "";
    const calls = filterCalls(deps.calls.list(), query);
    return reply.type("text/html").send(renderCallsPage(calls, query));
  });

  app.get("/calls/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const call = deps.calls.getById(id);
    if (!call) return reply.code(404).type("text/html").send(renderNotFound());
    return reply.type("text/html").send(renderCallDetail(call, deps.calls.listToolCalls(call.id)));
  });

  app.get("/appointments", async (_request, reply) => {
    const appointments = await deps.calendar.list();
    return reply.type("text/html").send(renderAppointmentsPage(appointments));
  });

  app.get("/api/calls", async () => deps.calls.list());

  app.get("/api/calls/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const call = deps.calls.getById(id);
    if (!call) return reply.code(404).send({ error: "not_found" });
    return { call, toolCalls: deps.calls.listToolCalls(call.id), lead: deps.calls.getLead(call.id) };
  });

  app.get("/api/appointments", async () => ({ appointments: await deps.calendar.list() }));
}
