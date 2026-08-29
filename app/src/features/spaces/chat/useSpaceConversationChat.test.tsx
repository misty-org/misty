import type { SpaceEvent, SpaceMessage } from "@/api/spaces/dto/interfaces/types";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  conversations: vi.fn(),
  conversationMessages: vi.fn(),
}));

vi.mock("@/api/spaces/api", () => ({
  spacesApi: apiMocks,
}));

import { useSpaceConversationChat } from "./hooks/useSpaceConversationChat";

let latest: ReturnType<typeof useSpaceConversationChat>;

function Harness() {
  latest = useSpaceConversationChat("space-1", "conversation-1", true);
  return null;
}

describe("useSpaceConversationChat realtime messages", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    apiMocks.conversations.mockReset().mockResolvedValue({ conversations: [] });
    apiMocks.conversationMessages.mockReset().mockResolvedValue({ messages: [] });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("applies the included event message without fetching the conversation again", async () => {
    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
      await Promise.resolve();
    });
    const included = messageFixture();
    const event: SpaceEvent = {
      id: 1,
      space_id: included.space_id,
      type: "message.created",
      actor_user_id: included.sender_user_id,
      entity_id: included.id,
      payload: included as unknown as Record<string, unknown>,
      created_at: included.created_at,
    };

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("misty:space-message-event", {
          detail: { spaceId: "space-1", conversationId: "conversation-1", event },
        }),
      );
    });

    expect(apiMocks.conversationMessages).toHaveBeenCalledOnce();
    expect(latest.messages).toEqual([included]);
  });

  it("keeps a failed optimistic row when a realtime refresh returns no replacement", async () => {
    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
      await Promise.resolve();
    });
    const failed = {
      ...messageFixture(),
      id: "optimistic-client-failed",
      local_delivery_state: "failed" as const,
    };
    await act(async () => latest.setMessages([failed]));

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("misty:space-message-event", {
          detail: { spaceId: "space-1", conversationId: "conversation-1" },
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(latest.messages).toEqual([failed]);
  });

  it("retries a failed conversation load without remounting the chat", async () => {
    apiMocks.conversationMessages
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce({ messages: [messageFixture()] });

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(latest.error).toBe("network unavailable");

    await act(async () => {
      latest.reload();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(latest.error).toBe("");
    expect(latest.messages).toEqual([messageFixture()]);
  });
});

function messageFixture(): SpaceMessage {
  return {
    seq: 1,
    id: "message-1",
    client_nonce: "client-1",
    space_id: "space-1",
    conversation_id: "conversation-1",
    sender_user_id: "user-1",
    sender_name: "Alex",
    sender_kind: "person",
    content: [{ type: "text", text: "Hello" }],
    file_node_ids: [],
    created_at: "2026-08-15T20:00:00Z",
  };
}
