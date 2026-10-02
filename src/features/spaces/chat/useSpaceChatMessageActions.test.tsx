import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { SpaceMessage } from "@/api/spaces/dto/interfaces/types";
import {
  useSpaceChatMessageActions,
  type SpaceChatMessageActionsOptions,
} from "./hooks/useSpaceChatMessageActions";
const api = vi.hoisted(() => ({ sendConversationMessage: vi.fn() }));
vi.mock("./SocialRuntime", () => ({ socialApi: api }));
afterEach(cleanup);
it("retries the original nonce and payload without touching the current draft", async () => {
  const failed: SpaceMessage = {
    id: "optimistic_original",
    seq: 1,
    client_nonce: "original",
    space_id: "s",
    conversation_id: "c",
    sender_user_id: "me",
    sender_name: "You",
    sender_kind: "person",
    content: [{ type: "text", text: "Original" }],
    file_node_ids: ["file"],
    library_item_ids: ["library"],
    reply_to_message_id: "reply",
    created_at: "2026-09-30",
    local_delivery_state: "failed",
  };
  let messages = [failed];
  const reset = vi.fn();
  const options = {
    spaceId: "s",
    conversationId: "c",
    currentUser: { id: "me", name: "You" },
    members: [],
    draft: { text: "New draft", reset },
    editing: {},
    setGroupMessages: (update: any) => {
      messages = typeof update === "function" ? update(messages) : update;
    },
    setGroupChatError: vi.fn(),
  } as unknown as SpaceChatMessageActionsOptions;
  api.sendConversationMessage.mockResolvedValue({
    message: { ...failed, id: "saved", local_delivery_state: undefined },
  });
  const { result } = renderHook(() => useSpaceChatMessageActions(options));
  await act(async () => {
    await result.current.retry(failed);
  });
  expect(api.sendConversationMessage).toHaveBeenCalledWith(
    "s",
    "c",
    failed.content,
    ["file"],
    [],
    ["library"],
    "reply",
    "original",
  );
  expect(reset).not.toHaveBeenCalled();
  expect(messages).toHaveLength(1);
  expect(messages[0].id).toBe("saved");
});
