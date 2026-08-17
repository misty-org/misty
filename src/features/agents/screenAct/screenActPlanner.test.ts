import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), runtimeConfig: undefined as unknown }));
vi.mock("@/api/client", () => ({ apiRequest: mocks.request }));
vi.mock("@midscene/core/ai-model", () => ({
  ConversationHistory: class {
    entries: string[] = [];
    appendHistoricalLog(entry: string) {
      this.entries.push(entry);
    }
  },
  getModelRuntime: (config: unknown) => {
    mocks.runtimeConfig = config;
    return config;
  },
  standardPlan: async (
    _goal: unknown,
    options: {
      modelRuntime: {
        createOpenAIClient(): Promise<{
          chat: { completions: { create(r: unknown, o: unknown): Promise<unknown> } };
        }>;
      };
    },
  ) => {
    const client = await options.modelRuntime.createOpenAIClient();
    await client.chat.completions.create({ messages: [{ role: "user", content: "look" }] }, {});
    await expect(client.chat.completions.create({ messages: [] }, {})).rejects.toThrow(
      "screen_model_call_limit",
    );
    return {
      actions: [
        {
          type: "click",
          param: { x: 0.4, y: 0.6, consequential: false, description: "Open settings" },
        },
      ],
    };
  },
}));
vi.mock("@midscene/core", async () => ({
  ScreenshotItem: { create: () => ({}) },
  z: (await import("zod")).z,
}));
vi.mock("@midscene/core/device", () => ({ defineAction: (action: unknown) => action }));
import { planScreenAction } from "./screenActPlanner";

it("plans through Misty's metered pass-through, once per step", async () => {
  mocks.request.mockResolvedValue({
    choices: [{ message: { role: "assistant", content: "<plan/>" } }],
  });
  const frame = {
    documentId: "doc",
    image: { dataUrl: "data:image/png;base64,AA", width: 10, height: 10 },
  };
  const plan = await planScreenAction("job 1", 3, frame, "Open settings", []);
  expect(mocks.request).toHaveBeenCalledOnce();
  expect(mocks.request.mock.calls[0][0]).toBe("/me/screen-model/job%201?call=3");
  expect(JSON.parse(mocks.request.mock.calls[0][1].body)).toEqual({
    messages: [{ role: "user", content: "look" }],
  });
  expect(plan).toMatchObject({
    action: { kind: "click", x: 0.4, y: 0.6 },
    consequential: false,
    description: "Open settings",
  });
});
