import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/api/client", () => ({ apiRequest: mocks.request }));
import { screenModelClient, screenModelConfig } from "./screenModel";

it("numbers every model call through Misty's metered pass-through", async () => {
  mocks.request.mockResolvedValue({
    model: "m",
    choices: [{ message: { role: "assistant", content: "<plan/>" } }],
  });
  const model = screenModelClient("job 1");
  const client = await model.createOpenAIClient();
  await client.chat.completions.create({ messages: [{ role: "user", content: "look" }] });
  const stream = (await client.chat.completions.create({
    messages: [{ role: "user", content: "again" }],
    stream: true,
  })) as AsyncGenerator<{ choices: Array<{ delta: { content: string } }> }>;
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk.choices[0].delta.content);
  expect(mocks.request.mock.calls.map(([path]) => path)).toEqual([
    "/me/screen-model/job%201?call=0",
    "/me/screen-model/job%201?call=1",
  ]);
  expect(JSON.parse(mocks.request.mock.calls[0][1].body)).toEqual({
    messages: [{ role: "user", content: "look" }],
  });
  expect(chunks).toEqual(["<plan/>"]);
  expect(model.calls()).toBe(2);
});

it("plans in its own slot so planning never asks the model to locate elements", () => {
  expect(screenModelConfig).toMatchObject({
    MIDSCENE_PLANNING_MODEL_NAME: "misty-run-model",
    MIDSCENE_PLANNING_MODEL_API_KEY: "misty-pass-through",
  });
});
