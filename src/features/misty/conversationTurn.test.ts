import { expect, it, vi } from "vitest";
import type { GlobalAiConversation, GlobalAiMessage } from "./types";

vi.mock("@/features/settings/deviceSettings", () => ({ useDevicePreferences: { getState: () => ({}) } }));

const { openTurn } = await import("./conversationTurn");

const message = { id: "u1", role: "user", content: "x", createdAt: "2026-11-06T10:00:00Z" } as GlobalAiMessage;
const blank = { id: "c", title: "Morning brief", messages: [] } as unknown as GlobalAiConversation;
const turn = (prompt: string, keepTitle?: boolean) => ({
  prompt,
  userMessage: message,
  assistantMessage: { id: "a1", role: "assistant", content: "", createdAt: message.createdAt } as GlobalAiMessage,
  isEcho: () => false,
  echoed: false,
  continuation: false,
  keepTitle,
  reasoningEffort: undefined,
});

it("names a new chat after its first prompt, unless a scheduled run keeps its workflow's name", () => {
  const prompt = "The user's scheduled workflow started this request automatically";
  expect(openTurn(blank, turn(prompt) as never).title).toBe(prompt.slice(0, 56));
  expect(openTurn(blank, turn(prompt, true) as never).title).toBe("Morning brief");
});
