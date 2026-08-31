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

  it("keeps conversations in one list and connected accounts at the bottom", async () => {
    const onConnectAccount = vi.fn();
    await act(async () => {
      root.render(
        <MemoryRouter>
          <SpaceChatConversationList
            activeSpaceId="space-1"
            activeConversationId={null}
            provider="instagram"
            currentUserId="user-1"
            conversations={[
              conversation("direct", "Mina", "misty", ["user-1", "user-2"]),
              conversation("group", "Launch", "misty", ["user-1", "user-2", "user-3"]),
              conversation("discord-art", "art", "discord", []),
              conversation("discord-builds", "builds", "discord", []),
              conversation("instagram-launch", "launch", "instagram", []),
            ]}
            onCreateConversation={vi.fn()}
            onEditConversation={vi.fn()}
            onConnectAccount={onConnectAccount}
            accounts={[
              {
                id: "instagram-account",
                provider: "instagram",
                account_display: "Misty Studio",
                status: "active",
              },
              {
                id: "discord-account",
                provider: "discord",
                account_display: "Misty Community",
                status: "active",
              },
            ]}
          />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Conversations - 1");
    expect(container.textContent).not.toContain("Instagram - 1");
    expect(container.querySelector('[aria-label="Filter Instagram conversations"]')).toBeNull();
    expect(container.textContent).not.toContain("Everyone");
    expect(container.textContent).not.toContain("Direct");
    expect(container.textContent).not.toContain("Group");
    expect(
      container.querySelector('a[href="/spaces/space-1/social/discord?conversation=discord-art"]'),
    ).toBeNull();
    expect(
      container.querySelector(
        'a[href="/spaces/space-1/social/instagram?conversation=instagram-launch"]',
      ),
    ).not.toBeNull();
    expect(container.textContent).toContain("Accounts");
    expect(container.textContent).toContain("Misty Studio");
    expect(container.textContent).not.toContain("Misty Community");
    const conversationList = container.querySelector('[aria-label="Instagram conversations"]');
    const accountsHeading = [...container.querySelectorAll("h2")].find(
      (heading) => heading.textContent?.trim() === "Accounts",
    );
    expect(
      Boolean(
        conversationList &&
        accountsHeading &&
        conversationList.compareDocumentPosition(accountsHeading) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    const instagramIcon = container.querySelector(
      'a[href*="conversation=instagram-launch"] [data-social-provider-icon="instagram"]',
    );
    expect(instagramIcon?.querySelector("linearGradient")).not.toBeNull();
    expect(container.querySelector('a[href="/spaces/space-1/social/discord"]')).toBeNull();
    expect(
      container
        .querySelector('a[href="/spaces/space-1/social/instagram"]')
        ?.getAttribute("aria-current"),
    ).toBe("page");
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Connect Instagram"]')?.click();
    });
    expect(onConnectAccount).toHaveBeenCalledWith("instagram");
  });

  it("offers only the current platform when no account is connected", async () => {
    const onConnectAccount = vi.fn();
    await act(async () => {
      root.render(
        <MemoryRouter>
          <SpaceChatConversationList
            activeSpaceId="space-1"
            activeConversationId={null}
            provider="discord"
            conversations={[]}
            onConnectAccount={onConnectAccount}
          />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Connect Discord");
    expect(container.textContent).not.toContain("Connect Instagram");
    expect(container.textContent).not.toContain("Instagram or Discord");
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Connect Discord"]')?.click();
    });
    expect(onConnectAccount).toHaveBeenCalledWith("discord");
  });

  it.each([
    ["instagram", "Conversations", "No conversations yet."],
    ["messenger", "Conversations", "No conversations yet."],
    ["discord", "Direct messages", "No direct messages yet."],
    ["x", "Direct messages", "No direct messages yet."],
  ] as const)("labels the %s sidebar by message type", async (provider, heading, emptyState) => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <SpaceChatConversationList
            activeSpaceId="space-1"
            activeConversationId={null}
            provider={provider}
            conversations={[]}
          />
        </MemoryRouter>,
      );
    });

    expect(
      [...container.querySelectorAll("h2, button")].some((item) =>
        item.textContent?.includes(heading),
      ),
    ).toBe(true);
    expect(container.textContent).toContain(emptyState);
    expect(container.textContent).not.toContain(`${provider} -`);
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
            provider="misty"
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
            provider="misty"
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
  origin: "misty" | "discord" | "instagram" | "messenger" | "x",
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
