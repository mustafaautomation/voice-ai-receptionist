import { SERVICE_LABELS, type ServiceId } from "../clinic.js";
import type { Appointment } from "../domain/types.js";
import { formatInClinic, formatStamp } from "../domain/time.js";
import type { CallRecord, ToolCallRecord } from "../calls/store.js";
import { outcomeLabel } from "./format.js";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function layout(title: string, active: "calls" | "appointments", body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · Brightside Dental</title>
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/assets/styles.css">
</head>
<body>
  <header class="top">
    <a class="brand" href="/calls">
      <span class="mark" aria-hidden="true"></span>
      <span>
        <strong>Brightside Dental</strong>
        <small>Reception log</small>
      </span>
    </a>
    <p class="demo-pill">Fictional clinic · demo data</p>
  </header>
  <nav class="tabs" aria-label="Sections">
    <a href="/calls" class="${active === "calls" ? "active" : ""}">Calls</a>
    <a href="/appointments" class="${active === "appointments" ? "active" : ""}">Appointments</a>
  </nav>
  <main>
    ${body}
  </main>
  <footer>
    <p>Mon–Fri 8:00–17:00, Sat 9:00–13:00, Sun closed. America/Chicago.</p>
    <p>1840 W North Ave, Chicago, IL 60622. This clinic is fictional.</p>
  </footer>
</body>
</html>`;
}

export function renderCallsPage(calls: CallRecord[], query: string): string {
  const rows = calls
    .map((call) => {
      const who = call.callerName || call.callerNumber || "Unknown caller";
      const when = formatStamp(call.startedAt);
      return `<tr>
        <td><a href="/calls/${escapeHtml(call.id)}">${escapeHtml(when)}</a></td>
        <td><a href="/calls/${escapeHtml(call.id)}">${escapeHtml(who)}</a>${call.afterHours ? '<span class="tag">After hours</span>' : ""}</td>
        <td><span class="pill ${escapeHtml(call.outcome)}">${escapeHtml(outcomeLabel(call.outcome))}</span></td>
        <td>${escapeHtml(call.summary || "No summary yet")}</td>
      </tr>`;
    })
    .join("");
  const body = `
    <div class="page-head">
      <h1>Calls</h1>
      <form method="get" action="/calls" role="search">
        <label for="q">Search</label>
        <input id="q" name="q" value="${escapeHtml(query)}" placeholder="Name, number, outcome">
        <button type="submit">Search</button>
      </form>
    </div>
    ${
      calls.length === 0
        ? `<p class="empty">${query ? "No calls match that search." : "No calls yet."}</p>`
        : `<div class="table-wrap"><table>
            <thead><tr><th>When</th><th>Caller</th><th>Outcome</th><th>Summary</th></tr></thead>
            <tbody>${rows}</tbody>
          </table></div>`
    }`;
  return layout("Calls", "calls", body);
}

export function renderCallDetail(call: CallRecord, tools: ToolCallRecord[]): string {
  const who = call.callerName || call.callerNumber || "Unknown caller";
  const toolCards = tools
    .map((tool) => {
      return `<article class="tool">
        <header><code>${escapeHtml(tool.name)}</code><time>${escapeHtml(formatStamp(tool.createdAt))}</time></header>
        <h3>Arguments</h3>
        <pre>${escapeHtml(JSON.stringify(tool.arguments, null, 2))}</pre>
        <h3>Result</h3>
        <pre>${escapeHtml(JSON.stringify(tool.result, null, 2))}</pre>
      </article>`;
    })
    .join("");
  const body = `
    <p class="back"><a href="/calls">All calls</a></p>
    <div class="page-head">
      <h1>${escapeHtml(who)}</h1>
      <span class="pill ${escapeHtml(call.outcome)}">${escapeHtml(outcomeLabel(call.outcome))}</span>
    </div>
    <dl class="meta">
      <div><dt>Started</dt><dd>${escapeHtml(formatStamp(call.startedAt))}</dd></div>
      <div><dt>Ended</dt><dd>${escapeHtml(call.endedAt ? formatStamp(call.endedAt) : "Still open")}</dd></div>
      <div><dt>Number</dt><dd>${escapeHtml(call.callerNumber || "Unknown")}</dd></div>
      <div><dt>CRM</dt><dd>${escapeHtml(call.crmStatus || "Not pushed")}${call.crmProvider ? ` · ${escapeHtml(call.crmProvider)}` : ""}</dd></div>
    </dl>
    <section>
      <h2>Summary</h2>
      <p class="summary">${escapeHtml(call.summary || "No summary yet.")}</p>
    </section>
    <div class="split">
      <section>
        <h2>Transcript</h2>
        <div class="transcript">${renderTranscript(call.transcript || "")}</div>
      </section>
      <section>
        <h2>Tool calls</h2>
        ${tools.length === 0 ? '<p class="empty">No tools were called.</p>' : toolCards}
      </section>
    </div>`;
  return layout(who, "calls", body);
}

export function renderAppointmentsPage(appointments: Appointment[]): string {
  const groups = new Map<string, Appointment[]>();
  for (const appointment of appointments) {
    const label = formatInClinic(appointment.startsAt).replace(/, \d{1,2}:\d{2} [AP]M CT$/, "");
    const list = groups.get(label) ?? [];
    list.push(appointment);
    groups.set(label, list);
  }
  const sections = [...groups.entries()]
    .map(([label, rows]) => {
      const items = rows
        .map((appointment) => {
          const service = SERVICE_LABELS[appointment.service as ServiceId] ?? appointment.service;
          return `<li>
            <div>
              <strong>${escapeHtml(formatInClinic(appointment.startsAt))}</strong>
              <span>${escapeHtml(appointment.patientName)} · ${escapeHtml(service)}</span>
            </div>
            <span class="pill ${appointment.status === "booked" ? "booked" : "cancelled"}">${escapeHtml(appointment.status === "booked" ? "Booked" : "Cancelled")}</span>
          </li>`;
        })
        .join("");
      return `<section class="day"><h2>${escapeHtml(label)}</h2><ul class="appts">${items}</ul></section>`;
    })
    .join("");
  const body = `
    <div class="page-head"><h1>Appointments</h1></div>
    ${appointments.length === 0 ? '<p class="empty">No appointments yet.</p>' : sections}`;
  return layout("Appointments", "appointments", body);
}

export function renderNotFound(): string {
  return layout("Not found", "calls", `<h1>Not found</h1><p class="empty">That page is not in this demo.</p>`);
}

function renderTranscript(transcript: string): string {
  if (!transcript.trim()) return '<p class="empty">No transcript stored.</p>';
  return transcript
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const match = /^(assistant|user|system|bot):\s*(.*)$/i.exec(line.trim());
      if (!match) return `<p class="line">${escapeHtml(line)}</p>`;
      const role = (match[1] ?? "system").toLowerCase();
      const text = match[2] ?? "";
      const css = role === "user" ? "user" : "assistant";
      return `<div class="bubble ${css}"><span class="who">${escapeHtml(css === "user" ? "Caller" : "Receptionist")}</span><p>${escapeHtml(text)}</p></div>`;
    })
    .join("");
}
