import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const discord = vi.hoisted(() => ({
  loading: false,
  providerConfigured: true as boolean | undefined,
  providerDiscoveryError: "",
  integration: {
    id: "integration-1",
    space_id: "space-1",
    provider: "discord",
    display_name: "Misty Guild",
    granted_permissions: [],
    status: "active",
    connected_by_user_id: "user-1",
    created_at: "2026-08-19T00:00:00Z",
    updated_at: "2026-08-19T00:00:00Z",
  },
  links: [
    {
      id: "link-1",
      space_id: "space-1",
      integration_id: "integration-1",
      conversation_id: "conversation-1",
      guild_id: "guild-1",
      guild_name: "Misty Guild",
      channel_id: "channel-1",
      channel_name: "design",
      direction: "two_way" as const,
      status: "needs_attention" as const,
      last_error_code: "missing_access" as const,
      connected_by_user_id: "user-1",
      created_at: "2026-08-19T00:00:00Z",
      updated_at: "2026-08-19T00:00:00Z",
    },
  ],
  channels: [],
  channelDiscoveryError: "",
  conversations: [
    {
      id: "conversation-1",
      space_id: "space-1",
      title: "design",
      created_by_user_id: "user-1",
      participants: [],
      origin: "discord" as const,
      created_at: "2026-08-19T00:00:00Z",
      updated_at: "2026-08-19T00:00:00Z",
    },
  ],
  conversationDiscoveryError: "",
  busy: "",
  error: "",
  reload: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  linkChannel: vi.fn(),
  setDirection: vi.fn(),
  sync: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock("./useDiscordLink", () => ({ useDiscordLink: () => discord }));

import { DiscordConnectionPanel } from "./DiscordConnectionPanel";

describe("DiscordConnectionPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("shows linked channel health, sync, unlink, and account disconnect inside Chat", async () => {
    await act(async () => {
      root.render(<DiscordConnectionPanel spaceId="space-1" canManage expandedByDefault />);
    });

    expect(container.textContent).toContain("#design in Misty Guild ↔ design");
    expect(container.textContent).toContain("Misty lost access to this channel");
    expect(container.textContent).toContain("Disconnecting preserves imported messages");

    await click(container.querySelector('button[aria-label="Sync #design"]'));
    await click(buttonNamed(container, "Unlink"));
    await click(buttonNamed(container, "Disconnect"));

    expect(discord.sync).toHaveBeenCalledWith("link-1");
    expect(discord.unlink).toHaveBeenCalledWith("link-1");
    expect(discord.disconnect).toHaveBeenCalledOnce();
  });
});

async function click(element: Element | null) {
  expect(element).not.toBeNull();
  await act(async () => {
    element!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function buttonNamed(container: HTMLElement, name: string) {
  return Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === name,
  )!;
}
