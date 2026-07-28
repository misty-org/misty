import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SpaceChatConversationList } from "@/features/spaces/components/SpaceChatConversationList";
import type { SpaceConversation } from "@/models/interfaces/features/spaces/types";

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

  it("keeps every Discord channel in one provider section outside Direct and Group", async () => {
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
            ]}
            onCreateConversation={vi.fn()}
            onEditConversation={vi.fn()}
          />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Direct - 1");
    expect(container.textContent).toContain("Group - 1");
    expect(container.textContent).toContain("Discord - 2");
    expect(
      container.querySelector('a[href="/spaces/space-1/chat?conversation=discord-art"]'),
    ).not.toBeNull();
    expect(container.querySelectorAll('[aria-label="Discord conversations"] a')).toHaveLength(2);
    expect(container.querySelector('[aria-label="Create a new discord conversation"]')).toBeNull();
  });
});

function conversation(
  id: string,
  title: string,
  origin: "misty" | "discord",
  memberIds: string[],
): SpaceConversation {
  return {
    id,
    space_id: "space-1",
    title,
    created_by_user_id: "user-1",
    origin,
    integration_status: "active",
    external_display_name: origin === "discord" ? title : undefined,
    members: memberIds.map((userId) => ({
      user_id: userId,
      name: userId,
      email: `${userId}@example.com`,
      joined_at: "2026-07-26T00:00:00Z",
    })),
    created_at: "2026-07-26T00:00:00Z",
    updated_at: "2026-07-26T00:00:00Z",
  };
}
