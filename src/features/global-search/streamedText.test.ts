import { afterEach, expect, it, vi } from "vitest";
import type { AiInvocationEvent } from "@/features/ai-surface";
import {
  applyGlobalInvocationEvent,
  flushStreamedText,
  type GlobalSearchGet,
  type GlobalSearchSet,
} from "./globalSearchStoreHelpers";
import type { GlobalSearchState } from "./globalSearchState";

function store(state: GlobalAiMessageState = "streaming") {
  let current = {
    conversations: [
      {
        id: "c1",
        title: "Chat",
        updatedAt: "2026-10-06T00:00:00.000Z",
        messages: [{ id: "m1", role: "assistant", mode: "ask", content: "", state }],
      },
    ],
  } as unknown as GlobalSearchState;
  const set = vi.fn((partial: Parameters<GlobalSearchSet>[0]) => {
    current = { ...current, ...(typeof partial === "function" ? partial(current) : partial) };
  }) as unknown as GlobalSearchSet & ReturnType<typeof vi.fn>;
  const get: GlobalSearchGet = () => current;
  const message = () => current.conversations[0].messages[0];
  return { set, get, message };
}
type GlobalAiMessageState = "streaming" | "completed" | "canceled";
const delta = (n: number, text: string) =>
  ({ id: `d${n}`, type: "response.delta", delta: text }) as AiInvocationEvent;

afterEach(() => flushStreamedText());

it("applies a burst of streamed text in one update per frame", () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "setTimeout"] });
  const { set, get, message } = store();
  for (const [n, text] of ["Hel", "lo ", "there"].entries())
    applyGlobalInvocationEvent(set, get, "c1", "m1", delta(n, text));
  expect(set).not.toHaveBeenCalled();
  vi.advanceTimersByTime(32);
  expect(set).toHaveBeenCalledTimes(1);
  expect(message().content).toBe("Hello there");
  vi.useRealTimers();
});

it("lands buffered text before the event that follows it", () => {
  const { set, get, message } = store();
  applyGlobalInvocationEvent(set, get, "c1", "m1", delta(1, "Partial "));
  applyGlobalInvocationEvent(set, get, "c1", "m1", {
    id: "a1",
    type: "assistant.message",
    text: "Final answer",
  } as AiInvocationEvent);
  expect(message().content).toBe("Final answer");
});

it("keeps a settled message settled when late text lands", () => {
  const { set, get, message } = store("canceled");
  applyGlobalInvocationEvent(set, get, "c1", "m1", delta(1, "late"));
  flushStreamedText();
  expect(message()).toMatchObject({ content: "late", state: "canceled" });
});
