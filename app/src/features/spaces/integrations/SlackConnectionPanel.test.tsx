import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const slack = vi.hoisted(() => ({
  loading: false,
  providerConfigured: true as boolean | undefined,
  providerDiscoveryError: "",
  integration: {
    id: "integration-1",
    provider: "slack",
    status: "active",
  },
  links: [
    {
      id: "link-1",
      conversation_id: "conversation-1",
      channel_id: "channel-1",
      channel_name: "#launch",
      team_name: "Misty Studio",
      direction: "two_way" as const,
      status: "active" as const,
      last_synced_at: "2026-08-19T00:00:00Z",
    },
  ],
  channels: [],
  channelDiscoveryError: "",
  conversations: [{ id: "conversation-1", title: "launch" }],
  busy: "",
  error: "",
  syncFeedback: "Imported 4 Slack messages.",
  reload: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  linkChannel: vi.fn(),
  setDirection: vi.fn(),
  sync: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock("./useSlackLink", () => ({ useSlackLink: () => slack }));
import { SlackConnectionPanel } from "./SlackConnectionPanel";

describe("SlackConnectionPanel", () => {
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

  it("shows linked Slack status, initial sync feedback, and management actions", async () => {
    await act(async () => {
      root.render(<SlackConnectionPanel spaceId="space-1" canManage expandedByDefault />);
    });

    expect(container.textContent).toContain("#launch in Misty Studio ↔ launch");
    expect(container.textContent).toContain("Imported 4 Slack messages");
    expect(container.textContent).toContain("Imported messages stay in Misty");

    await click(container.querySelector('button[aria-label="Sync #launch"]'));
    await click(buttonNamed(container, "Unlink"));
    await click(buttonNamed(container, "Disconnect"));
    expect(slack.sync).toHaveBeenCalledWith("link-1");
    expect(slack.unlink).toHaveBeenCalledWith("link-1");
    expect(slack.disconnect).toHaveBeenCalledOnce();
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
