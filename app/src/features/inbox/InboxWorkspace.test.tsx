import { resetConnectionsAccountState, useConnectionsStore } from "@/features/integrations";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InboxWorkspace } from "./InboxWorkspace";
import type { InboxThread } from "./model";
import { resetInboxAccountState, useInboxStore } from "./store/useInboxStore";

const { openProviderAuthorizationLink } = vi.hoisted(() => ({
  openProviderAuthorizationLink: vi.fn(),
}));

vi.mock("@/shared/platform/openExternalLink", () => ({
  openProviderAuthorizationLink,
}));

vi.mock("@/features/auth", () => ({
  useAuth: () => ({
    user: { id: "account-1", name: "Alex", email: "misty@example.com" },
    transitioning: false,
  }),
}));

describe("Inbox workspace", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    resetConnectionsAccountState();
    resetInboxAccountState();
    useConnectionsStore.setState({
      accountId: "account-1",
      loaded: true,
      loading: false,
      connections: [],
    });
    useInboxStore.setState({
      accountId: "account-1",
      loaded: true,
      loading: false,
      accounts: [],
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    resetConnectionsAccountState();
    resetInboxAccountState();
  });

  it("offers Gmail and Outlook without inventing placeholder email", async () => {
    await act(async () => root.render(<InboxWorkspace />));

    expect(container.querySelector('button[aria-label="Refresh inbox"]')).not.toBeNull();
    expect(container.querySelector('input[aria-label="Search mail"]')).toBeNull();
    expect(container.querySelector("h1")?.textContent).toBe("Inbox");
    expect(container.textContent).toContain("Compose");
    expect(container.textContent).toContain("Connect Gmail");
    expect(container.textContent).toContain("Connect Outlook");
    expect(container.textContent).toContain("No messages here");
    expect(container.querySelectorAll("[data-email-message]")).toHaveLength(0);
    expect(
      container.querySelector('button[aria-label="Choose messages to select"]'),
    ).not.toBeNull();
    expect(container.querySelector('button[aria-label="More inbox actions"]')).not.toBeNull();
    expect(container.textContent).toContain("0 of 0");
  });

  it.each([
    ["google", "Connect Gmail", "https://accounts.google.test/authorize"],
    ["microsoft", "Connect Outlook", "https://microsoft.test/authorize"],
  ])("opens %s authorization in the provider-safe browser", async (provider, label, url) => {
    useConnectionsStore.setState({
      beginAuthorization: vi.fn().mockResolvedValue(url),
    });
    await act(async () => root.render(<InboxWorkspace />));

    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    expect(button).toBeDefined();
    await act(async () => button?.click());

    expect(useConnectionsStore.getState().beginAuthorization).toHaveBeenCalledWith(
      provider,
      ["mail"],
      "/inbox",
    );
    expect(openProviderAuthorizationLink).toHaveBeenCalledWith(url);
  });

  it("shows a connected account while keeping the message area genuinely empty", async () => {
    useInboxStore.setState({
      accounts: [
        {
          connection_id: "gmail-1",
          provider: "google",
          account_id: "google-account-1",
          display_name: "Alex Gmail",
          email: "alex@example.com",
          total: 0,
          unread: 0,
        },
      ],
    });
    await act(async () => root.render(<InboxWorkspace />));

    expect(container.textContent).toContain("alex@example.com");
    expect(container.textContent).toContain("No messages here");
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label="Show message"]')?.disabled,
    ).toBe(true);
  });

  it("toggles the account shelf from the bottom bar", async () => {
    await act(async () => root.render(<InboxWorkspace />));

    expect(container.querySelector("[data-inbox-left-shelf]")).not.toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Hide left shelf"]')?.click();
    });

    expect(container.querySelector("[data-inbox-left-shelf]")).toBeNull();
    expect(container.querySelector('button[aria-label="Show left shelf"]')).not.toBeNull();
  });

  it("slides a selected message over the list and back out", async () => {
    const selectedThread: InboxThread = {
      provider: "gmail",
      provider_id: "thread-1",
      account_id: "google-account-1",
      connectionId: "gmail-1",
      key: "gmail-1:thread-1",
      subject: "A real message",
      snippet: "Message preview",
      participants: [{ email: "sender@example.com" }],
      labels: ["INBOX"],
      last_message_at: "2026-08-19T12:00:00Z",
      unread: false,
      starred: false,
      messages: [],
    };
    useInboxStore.setState({
      selectedThread,
      selectedThreadKey: selectedThread.key,
      threadsByConnection: { "gmail-1": [selectedThread] },
      estimatedTotalByConnection: { "gmail-1": 134 },
    });

    await act(async () => root.render(<InboxWorkspace />));

    const messageView = container.querySelector("[data-inbox-message-view]");
    expect(messageView?.getAttribute("data-state")).toBe("closed");
    expect(container.textContent).toContain("1–1 of 134");

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Show message"]')?.click();
    });
    expect(messageView?.getAttribute("data-state")).toBe("open");

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Back to inbox"]')?.click();
    });
    expect(messageView?.getAttribute("data-state")).toBe("closed");
  });
});
