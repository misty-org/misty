import { expect, it, vi } from "vitest";
import type { GlobalAiConversation, GlobalAiMessage } from "../state/conversationTypes";

vi.mock("@/features/settings/deviceSettings", () => ({
  useDevicePreferences: { getState: () => ({}) },
}));

const { openTurn } = await import("./conversationTurn");

const message = {
  id: "u1",
  role: "user",
  content: "x",
  createdAt: "2026-11-06T10:00:00Z",
} as GlobalAiMessage;
const blank = { id: "c", title: "Morning brief", messages: [] } as unknown as GlobalAiConversation;
const turn = (prompt: string) => ({
  prompt,
  userMessage: message,
  assistantMessage: {
    id: "a1",
    role: "assistant",
    content: "",
    createdAt: message.createdAt,
  } as GlobalAiMessage,
  isEcho: () => false,
  echoed: false,
  continuation: false,
  reasoningEffort: undefined,
});

it("names a new chat after its first prompt", () => {
  const prompt = "Find the three slowest tests in this repository and explain why";
  expect(openTurn(blank, turn(prompt) as never).title).toBe(prompt.slice(0, 56));
});
