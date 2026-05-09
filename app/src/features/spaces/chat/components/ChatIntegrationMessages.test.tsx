import type { SpaceMessage } from "@/api/spaces/dto/interfaces/types";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageOriginBadge } from "../../components/MessageOriginBadge";
import { MessageHoverActions } from "./MessageHoverActions";

describe("Chat integration message controls", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("attributes inbound Discord messages", async () => {
    await act(async () => {
      root.render(
        <MessageOriginBadge
          origin={{ system: "discord", external_id: "external-1", author_handle: "rey" }}
        />,
      );
    });

    expect(container.textContent).toContain("Discord");
    expect(container.textContent).toContain("@rey");
    expect(container.querySelector('[title="Received from Discord"]')).not.toBeNull();
  });

  it("attributes inbound Slack messages", async () => {
    await act(async () => {
      root.render(
        <MessageOriginBadge
          origin={{ system: "slack", external_id: "123.45", author_handle: "U123" }}
        />,
      );
    });

    expect(container.textContent).toContain("Slack");
    expect(container.textContent).toContain("U123");
    expect(container.querySelector('[title="Received from Slack"]')).not.toBeNull();
  });

  it("publishes only through the explicit message action", async () => {
    const onPublish = vi.fn();
    await act(async () => {
      root.render(
        <MessageHoverActions
          message={message()}
          currentUserId="user-1"
          isOwner
          onReply={vi.fn()}
          onToggleReaction={vi.fn()}
          onBeginEditing={vi.fn()}
          onDelete={vi.fn()}
          onPublish={onPublish}
        />,
      );
    });

    expect(onPublish).not.toHaveBeenCalled();
    const button = container.querySelector('button[aria-label="Send to Discord"]');
    expect(button).not.toBeNull();
    await act(async () => {
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onPublish).toHaveBeenCalledOnce();
  });

  it("labels the explicit Slack publish action with the correct provider", async () => {
    await act(async () => {
      root.render(
        <MessageHoverActions
          message={message()}
          currentUserId="user-1"
          isOwner
          onReply={vi.fn()}
          onToggleReaction={vi.fn()}
          onBeginEditing={vi.fn()}
          onDelete={vi.fn()}
          onPublish={vi.fn()}
          publishProvider="Slack"
        />,
      );
    });

    expect(container.querySelector('button[aria-label="Send to Slack"]')).not.toBeNull();
  });
});

function message(): SpaceMessage {
  return {
    seq: 1,
    id: "message-1",
    space_id: "space-1",
    conversation_id: "conversation-1",
    sender_user_id: "user-1",
    sender_name: "Rey",
    sender_kind: "person",
    content: [{ type: "text", text: "Ship it" }],
    file_node_ids: [],
    reactions: [],
    created_at: "2026-08-19T00:00:00Z",
  };
}
