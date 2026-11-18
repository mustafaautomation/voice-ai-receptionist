// Browser call to the Vapi assistant. The public key and assistant id are
// meant to be public; the private API key never reaches the browser.
const button = document.getElementById("talk");
const consoleEl = document.getElementById("console");
const statusEl = document.getElementById("status");
const levelEl = document.getElementById("level");
const transcriptEl = document.getElementById("transcript");
const label = button.querySelector(".label");

const publicKey = button.dataset.publicKey;
const assistantId = button.dataset.assistantId;

let vapi = null;
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

async function load() {
  const mod = await import("https://esm.sh/@vapi-ai/web@3.1.1");
  const Vapi = mod.default?.default ?? mod.default;
  const client = new Vapi(publicKey);
  client.on("call-start", () => setState("live", "Connected. Say hello."));
  client.on("call-end", () => {
    setState("idle", "Call ended. Your booking, if you made one, is on the appointments page.");
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
    vapi ??= await load();
    transcriptEl.replaceChildren();
    partial = null;
    await vapi.start(assistantId);
  } catch (error) {
    console.error(error);
    setState("idle", "The call could not start. Check microphone permission and try again.");
  }
});
