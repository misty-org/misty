import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  misty: { conversations: [] as unknown[] },
  entry: vi.fn(),
}));
vi.mock("@/features/agents/conversations/state/useMistyStore", () => ({
  useMistyStore: { getState: () => mocks.misty },
}));
vi.mock("./runContexts", () => ({ loadRunEntry: mocks.entry }));

import { appRunRequest } from "./appsRun";

const chat = {
  id: "chat",
  messages: [
    { id: "1", role: "user", content: "Old question" },
    { id: "2", role: "assistant", content: "", invocationId: "run_old" },
    { id: "3", role: "user", content: "Search with Exa" },
    { id: "4", role: "user", content: "Continue the request above.", source: "continuation" },
    { id: "5", role: "assistant", content: "", invocationId: "run_1" },
  ],
};
const entry = (permissionMode: string) => ({ conversationId: "chat", permissionMode });

beforeEach(() => {
  mocks.misty.conversations = [chat];
  mocks.entry.mockReset();
  mocks.entry.mockResolvedValue(entry("ask"));
});

it("reads what the person asked, past Misty's own continuation", async () => {
  await expect(appRunRequest("run_1")).resolves.toBe("Search with Exa");
  await expect(appRunRequest("run_old")).resolves.toBe("Old question");
  mocks.misty.conversations = [];
  await expect(appRunRequest("run_1")).resolves.toBe("");
});
