import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { GlobalAiConversation, GlobalAiMessage } from "@/features/global-search/types";
import { AgentConversationView } from "./AgentConversationView";

afterEach(cleanup);

function message(
  id: string,
  role: GlobalAiMessage["role"],
  content: string,
  extra: Partial<GlobalAiMessage> = {},
): GlobalAiMessage {
  return {
    id,
    role,
    mode: "ask",
    content,
    createdAt: "2026-10-05T12:00:00Z",
    state: "completed",
    ...extra,
  };
}

function conversation(messages: GlobalAiMessage[]) {
  return { id: "conversation", messages } as unknown as GlobalAiConversation;
}

it("marks where Misty's summarized notes end", () => {
  render(
    <AgentConversationView
      working={false}
      onRetry={() => {}}
      conversation={conversation([
        message("1-user", "user", "Plan the launch"),
        message("1-assistant", "assistant", "Here is the plan.", { compactedAfter: true }),
        message("2-user", "user", "Move it to Friday"),
        message("2-assistant", "assistant", "Moved to Friday."),
      ])}
    />,
  );
  const divider = screen.getByRole("separator", { name: "Earlier messages summarized" });
  const before = screen.getByText("Here is the plan.");
  const after = screen.getByText("Move it to Friday");
  expect(before.compareDocumentPosition(divider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(divider.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("shows no divider before anything was summarized", () => {
  render(
    <AgentConversationView
      working={false}
      onRetry={() => {}}
      conversation={conversation([
        message("1-user", "user", "Hi"),
        message("1-assistant", "assistant", "Hello."),
      ])}
    />,
  );
  expect(screen.queryByRole("separator", { name: "Earlier messages summarized" })).toBeNull();
});
