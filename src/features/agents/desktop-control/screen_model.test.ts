import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("../engines/misty_calls", () => ({ screenModelOnEngine: mocks.call }));
import { screenModelClient, screenModelConfig } from "./screen_model";

it("sends every model call to the default engine", async () => {
  mocks.call.mockResolvedValue({
    model: "m",
    choices: [{ message: { role: "assistant", content: "<plan/>" } }],
  });
  const model = screenModelClient();
  const client = await model.createOpenAIClient();
  await client.chat.completions.create({ messages: [{ role: "user", content: "look" }] });
  const stream = (await client.chat.completions.create({
    messages: [{ role: "user", content: "again" }],
    stream: true,
  })) as AsyncGenerator<{ choices: Array<{ delta: { content: string } }> }>;
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk.choices[0].delta.content);
  expect(mocks.call.mock.calls.map(([messages]) => messages)).toEqual([
    [{ role: "user", content: "look" }],
    [{ role: "user", content: "again" }],
  ]);
  expect(chunks).toEqual(["<plan/>"]);
  expect(model.calls()).toBe(2);
});

it("plans in its own slot so planning never asks the model to locate elements", () => {
  expect(screenModelConfig).toMatchObject({
    MIDSCENE_PLANNING_MODEL_NAME: "misty-run-model",
    MIDSCENE_PLANNING_MODEL_API_KEY: "misty-pass-through",
  });
});
