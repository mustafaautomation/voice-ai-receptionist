import { describe, expect, test } from "vitest";
import { buildApp } from "../../src/app.js";
import { filterCalls } from "../../src/dashboard/format.js";
import { escapeHtml, renderCallsPage } from "../../src/dashboard/render.js";
import { seedIfEmpty } from "../../src/seed.js";
import { CallStore } from "../../src/calls/store.js";
import { memoryDb, testConfig } from "../helpers.js";

describe("dashboard", () => {
  test("escapes transcript text and filters the call list", async () => {
    expect(escapeHtml(`<script>alert("x")</script>`)).toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    const db = memoryDb();
    expect(seedIfEmpty(db, new Date("2026-11-18T15:00:00.000Z"))).toBe(true);
    expect(seedIfEmpty(db, new Date("2026-11-18T15:00:00.000Z"))).toBe(false);
    const calls = new CallStore(db);
    const maya = calls.list().find((call) => call.callerName === "Maya Chen");
    if (!maya) throw new Error("seed missing Maya");
    maya.summary = `<script>alert("x")</script>`;
    const html = renderCallsPage([maya], "maya");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert");
    expect(filterCalls(calls.list(), "helen")).toHaveLength(1);
    expect(filterCalls(calls.list(), "nobody-here")).toHaveLength(0);

    const app = await buildApp({ config: testConfig(), db, now: () => new Date("2026-11-18T15:00:00.000Z") });
    const list = await app.inject({ method: "GET", url: "/calls?q=Maya" });
    expect(list.statusCode).toBe(200);
    expect(list.body).toContain("Maya Chen");
    expect(list.body).not.toContain("Helen Cho");
    const detail = await app.inject({ method: "GET", url: "/calls/call_maya" });
    expect(detail.body).toContain("book_appointment");
    expect(detail.body).toContain("cleaning");
    const appointments = await app.inject({ method: "GET", url: "/appointments" });
    expect(appointments.body).toContain("Andre Brooks");
    expect(appointments.body).toContain("Cancelled");
    const missing = await app.inject({ method: "GET", url: "/calls/missing" });
    expect(missing.statusCode).toBe(404);
    const home = await app.inject({ method: "GET", url: "/" });
    expect(home.statusCode).toBe(200);
    expect(home.body).toContain("Talk to the receptionist");
    expect(home.headers["content-security-policy"]).toBeUndefined();
    expect(list.headers["content-security-policy"]).toContain("default-src 'self'");
    const css = await app.inject({ method: "GET", url: "/assets/talk.css" });
    expect(css.statusCode).toBe(200);
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.json()).toMatchObject({ ok: true });
    const api = await app.inject({ method: "GET", url: "/api/appointments" });
    expect(api.json().appointments.length).toBeGreaterThan(0);
    await app.close();
  });

  test("renders an empty state", () => {
    const html = renderCallsPage([], "");
    expect(html).toContain("No calls yet.");
  });
});
