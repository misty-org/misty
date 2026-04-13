import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentChatList } from "@/pages/Agents/desktop/AgentChatList";
import { useAgentSessionStore } from "@/stores/agent/useAgentSessionStore";

describe("AgentChatList", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    useAgentSessionStore.setState({
      conversations: [
        { id: "chat-1", title: "New chat", updatedAt: 2, createdAt: 2 },
        { id: "chat-2", title: "Research notes", updatedAt: 1, createdAt: 1 },
      ],
      activeConversationId: "chat-1",
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps selection and delete inside one full-width row", async () => {
    await act(async () => root.render(<AgentChatList />));

    const activeButton = container.querySelector<HTMLButtonElement>('button[aria-current="true"]');
    const deleteButton = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.getAttribute("aria-label") === 'Delete chat "New chat"',
    );

    expect(activeButton).not.toBeNull();
    expect(deleteButton).not.toBeNull();
    expect(activeButton?.parentElement).toBe(deleteButton?.parentElement);
    expect(activeButton?.className).toContain("flex-1");
    expect(deleteButton?.className).not.toContain("absolute");
    expect(activeButton?.parentElement?.className).toContain("bg-sidebar-accent");
    expect(activeButton?.parentElement?.className).toContain("bg-none");
  });
});
