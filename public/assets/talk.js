// Browser call to the Vapi assistant. Before each call the page asks this
// server for a short-lived token. The server applies the per-visitor and daily
// limits, so there is no reusable key in the page.
const button = document.getElementById("talk");
const consoleEl = document.getElementById("console");
const statusEl = document.getElementById("status");
const levelEl = document.getElementById("level");
const transcriptEl = document.getElementById("transcript");
const label = button.querySelector(".label");

let vapi = null;
let VapiClass = null;
let live = false;
let partial = null;

function setState(state, text) {
  consoleEl.dataset.state = state;
  if (text) statusEl.textContent = text;
  live = state === "live";
  label.textContent = live ? "End call" : "Talk to the receptionist";
  button.disabled = state === "connecting";
}

function addLine(role, text, final = true) {
  if (partial && partial.dataset.role === role) {
    partial.querySelector("span").textContent = text;
    if (final) partial = null;
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
    return;
  }
  const li = document.createElement("li");
  li.className = role;
  li.dataset.role = role;
  const who = document.createElement("b");
  who.textContent = role === "assistant" ? "Receptionist" : role === "user" ? "You" : "Tool";
  const span = document.createElement("span");
  span.textContent = text;
  li.append(who, span);
  transcriptEl.append(li);
  partial = final ? null : li;
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

class LimitError extends Error {}

async function requestToken() {
  const response = await fetch("/api/call-token", { method: "POST", headers: { accept: "application/json" } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new LimitError(body.message || "The demo cannot start a call right now. Please try again later.");
  return body;
}

async function load(token) {
  if (!VapiClass) {
    const mod = await import("https://esm.sh/@vapi-ai/web@3.1.1");
    VapiClass = mod.default?.default ?? mod.default;
  }
  // A new client per call: the SDK keeps the token it was built with.
  const client = new VapiClass(token);
  client.on("call-start", () => setState("live", "Connected. Say hello."));
  client.on("call-end", () => {
    const left = Number(consoleEl.dataset.callsLeft);
    const note = Number.isFinite(left) ? ` You have ${left} demo call${left === 1 ? "" : "s"} left today.` : "";
    setState("idle", `Call ended. Your booking, if you made one, is on the appointments page.${note}`);
    levelEl.style.width = "0";
  });
  client.on("speech-start", () => { if (live) statusEl.textContent = "Receptionist is speaking…"; });
  client.on("speech-end", () => { if (live) statusEl.textContent = "Listening…"; });
  client.on("volume-level", (v) => { levelEl.style.width = `${Math.min(100, Math.round(v * 100))}%`; });
  client.on("message", (m) => {
    if (m.type === "transcript" && m.transcript) {
      addLine(m.role === "assistant" ? "assistant" : "user", m.transcript, m.transcriptType === "final");
    } else if (m.type === "tool-calls" && Array.isArray(m.toolCallList)) {
      for (const call of m.toolCallList) addLine("tool", `Calling ${call.function?.name ?? "a tool"}…`);
    }
  });
  client.on("error", (e) => {
    console.error(e);
    const text = JSON.stringify(e?.error ?? e ?? "");
    const credits = /credit|balance|wallet|payment/i.test(text);
    setState("idle", credits
      ? "The demo is out of free voice credits right now. The source and call log are still available."
      : "The call could not connect. Check microphone permission and try again.");
  });
  return client;
}

button.addEventListener("click", async () => {
  if (live) {
    vapi?.stop();
    return;
  }
  setState("connecting", "Connecting… allow microphone access if asked.");
  try {
    const grant = await requestToken();
    vapi = await load(grant.token);
    transcriptEl.replaceChildren();
    partial = null;
    await vapi.start(grant.assistantId);
    if (typeof grant.callsLeft === "number") {
      consoleEl.dataset.callsLeft = String(grant.callsLeft);
    }
  } catch (error) {
    console.error(error);
    if (error instanceof LimitError) {
      setState("limited", error.message);
      return;
    }
    setState("idle", "The call could not start. Check microphone permission and try again.");
  }
});
