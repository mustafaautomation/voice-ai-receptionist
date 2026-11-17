import { loadConfig } from "../src/config.js";
import { syncAssistant } from "../src/vapi/sync.js";

const config = loadConfig();
const result = await syncAssistant({
  apiKey: config.vapiApiKey || undefined,
  publicBaseUrl: config.publicBaseUrl,
  serverUrlSecret: config.vapiWebhookSecret,
  model: config.openaiModel,
});

if (result.mode === "dry-run") {
  console.log("VAPI_API_KEY is not set. Dry run only; nothing was sent to Vapi.");
  console.log(JSON.stringify({ name: result.payload.name, serverUrl: result.payload.serverUrl, tools: result.payload.model.tools.map((tool) => tool.function.name) }, null, 2));
} else {
  console.log(`${result.mode} assistant ${result.assistantId ?? ""}`.trim());
}
