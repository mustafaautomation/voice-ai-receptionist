import { loadEnvFile } from "../config.js";
import { SCENARIOS } from "./scenarios.js";
import { runLiveScenario } from "./live.js";
import { runScenario, scenarioPassed } from "./run.js";

loadEnvFile();
const live = process.env.EVAL_MODE === "live";
if (live && !process.env.OPENAI_API_KEY) {
  console.error("EVAL_MODE=live requires OPENAI_API_KEY. CI uses the scripted model and does not need a key.");
  process.exit(1);
}

const failures: string[] = [];
for (const scenario of SCENARIOS) {
  const result = live
    ? await runLiveScenario(scenario, {
        apiKey: process.env.OPENAI_API_KEY ?? "",
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      })
    : await runScenario(scenario);
  const pass = scenarioPassed(scenario, result);
  const tools = result.trace.map((entry) => entry.name).join(",") || "(none)";
  console.log(`${pass ? "PASS" : "FAIL"} ${scenario.id} outcome=${result.outcome} tools=${tools}`);
  if (!pass) failures.push(scenario.id);
}

if (failures.length > 0) {
  console.error(`Failed: ${failures.join(", ")}`);
  process.exit(1);
}
console.log(live ? "Live evals passed." : "Scripted evals passed.");
