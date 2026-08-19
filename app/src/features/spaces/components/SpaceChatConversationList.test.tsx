import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SpaceConversation } from "@/api/spaces/dto/interfaces/types";
import { SpaceChatConversationList } from "../components/SpaceChatConversationList";

describe("SpaceChatConversationList", () => {
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

  it("keeps native conversations and groups linked Discord channels in Chat", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <SpaceChatConversationList
            activeSpaceId="space-1"
            activeConversationId={null}
            currentUserId="user-1"
            conversations={[
              conversation("direct", "Mina", "misty", ["user-1", "user-2"]),
              conversation("group", "Launch", "misty", ["user-1", "user-2", "user-3"]),
              conversation("discord-art", "art", "discord", []),
              conversation("discord-builds", "builds", "discord", []),
              conversation("slack-launch", "launch", "slack", []),
            ]}
            onCreateConversation={vi.fn()}
            onEditConversation={vi.fn()}
          />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Conversations - 2");
    expect(container.textContent).toContain("Discord - 2");
    expect(container.textContent).toContain("Slack - 1");
    expect(container.textContent).toContain("Everyone");
    expect(container.querySelector('a[href="/spaces/space-1/chat"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Direct");
    expect(container.textContent).not.toContain("Group");
    expect(
      container.querySelector('a[href="/spaces/space-1/chat?conversation=discord-art"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('a[href="/spaces/space-1/chat?conversation=slack-launch"]'),
    ).not.toBeNull();
  });

  it("keeps edit and delete inside the conversation context menu", async () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    await act(async () => {
      root.render(
        <MemoryRouter>
          <SpaceChatConversationList
            activeSpaceId="space-1"
            activeConversationId={null}
            currentUserId="user-1"
            conversations={[conversation("group", "Launch", "misty", ["user-1", "user-2"])]}
            onEditConversation={onEdit}
            onDeleteConversation={onDelete}
          />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('button[aria-label="Edit Launch"]')).toBeNull();
    const link = container.querySelector('a[href*="conversation=group"]');
    expect(link).not.toBeNull();
    await act(async () => {
      link!.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 20,
          clientY: 20,
        }),
      );
    });

    const menu = document.body.querySelector('[role="menu"]');
    expect(menu?.textContent).toContain("Edit conversation");
    expect(menu?.textContent).toContain("Delete conversation");
  });

  it("hides the shared Everyone channel in Misty", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <SpaceChatConversationList
            activeSpaceId="space_misty_canonical"
            activeConversationId="support"
            currentUserId="user-1"
            conversations={[conversation("support", "My support", "misty", ["user-1"])]}
            isMistySpace
          />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).not.toContain("Everyone");
    expect(container.querySelector('a[href$="conversation=support"]')).not.toBeNull();
  });
});

function conversation(
  id: string,
  title: string,
  origin: "misty" | "discord" | "slack",
  memberIds: string[],
): SpaceConversation {
  return {
    id,
    space_id: "space-1",
    title,
    created_by_user_id: "user-1",
    origin,
    integration_status: "active",
    external_display_name: origin === "misty" ? undefined : title,
    participants: memberIds.map((userId) => ({
      kind: "person" as const,
      user_id: userId,
      name: userId,
      email: `${userId}@example.com`,
      joined_at: "2026-07-26T00:00:00Z",
    })),
    created_at: "2026-07-26T00:00:00Z",
    updated_at: "2026-07-26T00:00:00Z",
  };
}
