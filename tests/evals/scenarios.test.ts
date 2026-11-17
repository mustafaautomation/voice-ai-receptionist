import { describe, expect, test } from "vitest";
import { SCENARIOS } from "../../src/evals/scenarios.js";
import { runLiveScenario } from "../../src/evals/live.js";
import { runScenario, scenarioPassed } from "../../src/evals/run.js";

describe("scripted conversation evals", () => {
  test.each(SCENARIOS.map((scenario) => [scenario.id, scenario] as const))("%s", async (_id, scenario) => {
    const result = await runScenario(scenario);
    expect(scenarioPassed(scenario, result), JSON.stringify({ outcome: result.outcome, trace: result.trace }, null, 2)).toBe(
      true,
    );
  });
});

describe("optional live eval loop", () => {
  test("executes tool calls returned by a fake completion API", async () => {
    const scenario = SCENARIOS.find((item) => item.id === "angry-caller-transfer");
    if (!scenario) throw new Error("missing scenario");
    let step = 0;
    const result = await runLiveScenario(scenario, {
      apiKey: "test-key",
      model: "fake",
      fetchImpl: async () => {
        step += 1;
        if (step === 1) {
          return Response.json({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: "call_1",
                      function: {
                        name: "transfer_to_human",
                        arguments: JSON.stringify({ reason: "Caller asked for a person." }),
                      },
                    },
                  ],
                },
              },
            ],
          });
        }
        return Response.json({ choices: [{ message: { content: "Transferring you now.", tool_calls: [] } }] });
      },
    });
    expect(result.outcome).toBe("transferred");
    expect(result.trace.map((entry) => entry.name)).toEqual(["transfer_to_human"]);
    expect(step).toBe(2);
  });

  test("fails closed when the completion API errors", async () => {
    const scenario = SCENARIOS[0];
    if (!scenario) throw new Error("missing scenario");
    await expect(
      runLiveScenario(scenario, {
        apiKey: "test-key",
        model: "fake",
        fetchImpl: async () => new Response("no", { status: 500 }),
      }),
    ).rejects.toThrow(/OpenAI/);
  });
});
