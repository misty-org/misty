import { resetConnectionsAccountState, useConnectionsStore } from "@/features/integrations";
import { useActivityStore } from "@/features/activity";
import type * as OpenExternalLinkModule from "@/shared/platform/openExternalLink";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InboxWorkspace } from "./InboxWorkspace";
import type { InboxThread } from "./model";
import { resetInboxAccountState, useInboxStore } from "./store/useInboxStore";

const { openProviderAuthorizationLink } = vi.hoisted(() => ({
  openProviderAuthorizationLink: vi.fn(),
}));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-probe">{`${location.pathname}${location.search}`}</output>;
}

const inboxSurface = (entry = "/inbox") => (
  <MemoryRouter key={entry} initialEntries={[entry]}>
    <InboxWorkspace />
    <LocationProbe />
  </MemoryRouter>
);

vi.mock("@/shared/platform/openExternalLink", async (importOriginal) => {
  const actual = await importOriginal<typeof OpenExternalLinkModule>();
  return {
    ...actual,
    openProviderAuthorizationLink,
  };
});

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
    useActivityStore.setState({
      accountId: "account-1",
      sourceItems: [],
      localItems: [],
      allItems: [],
      attentionItems: [],
      attentionCount: 0,
    });
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

  it("keeps account connection behind the selected provider's plus button", async () => {
    await act(async () => root.render(inboxSurface()));

    expect(container.querySelector('button[aria-label="Refresh inbox"]')).not.toBeNull();
    expect(container.querySelector('input[aria-label="Search mail"]')).not.toBeNull();
    expect(container.textContent).toContain("All");
    expect(container.textContent).toContain("Unread");
    expect(container.textContent).toContain("Starred");
    expect(container.textContent).toContain("Attachments");
    expect(container.querySelector("h1")).toBeNull();
    expect(container.textContent).toContain("Compose");
    expect(container.querySelector('button[aria-label="Collapse Accounts"]')).not.toBeNull();
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label="Add Gmail account"]')
        ?.className,
    ).toContain("opacity-0");
    expect(container.textContent).toContain("No Gmail accounts yet.");
    expect(container.textContent).not.toContain("Connect Gmail");
    expect(container.textContent).not.toContain("Connect Outlook");
    expect(container.textContent).toContain("No messages here");
    expect(container.querySelectorAll("[data-email-message]")).toHaveLength(0);
    expect(
      container.querySelector('button[aria-label="Choose messages to select"]'),
    ).not.toBeNull();
    expect(container.querySelector('button[aria-label="Mark all as read"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Mark all as unread"]')).not.toBeNull();
    expect(container.textContent).toContain("0 of 0");
  });

  it.each([
    ["google", "Gmail", "https://accounts.google.test/authorize"],
    ["microsoft", "Outlook", "https://microsoft.test/authorize"],
  ])("opens %s authorization directly from plus", async (provider, label, url) => {
    useInboxStore.setState({ selectedProvider: provider });
    useConnectionsStore.setState({
      beginAuthorization: vi.fn().mockResolvedValue(url),
    });
    await act(async () => root.render(inboxSurface()));

    const button = container.querySelector<HTMLButtonElement>(
      `button[aria-label="Add ${label} account"]`,
    );
    expect(button).not.toBeNull();
    await act(async () => button?.click());

    expect(useConnectionsStore.getState().beginAuthorization).toHaveBeenCalledWith(
      provider,
      ["mail"],
      "/inbox",
    );
    expect(openProviderAuthorizationLink).toHaveBeenCalledWith(url);
  });

  it("reconnects an account whose provider authorization expired", async () => {
    useInboxStore.setState({
      accounts: [
        {
          connection_id: "gmail-expired",
          provider: "google",
          account_id: "google-account-1",
          display_name: "Alex Gmail",
          email: "alex@example.com",
          total: 0,
          unread: 0,
          status: "needs_attention",
          error_code: "refresh_failed",
        },
      ],
      accountErrors: {
        "gmail-expired": "Session expired. Reconnect this email account.",
      },
    });
    useConnectionsStore.setState({
      beginAuthorization: vi.fn().mockResolvedValue("https://accounts.google.test/reconnect"),
    });

    await act(async () => root.render(inboxSurface()));

    const configure = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Configure Gmail account alex@example.com"]',
    );
    expect(configure?.querySelector("svg")?.classList).toContain("size-4");
    await act(async () => configure?.click());
    const reconnect = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Reconnect account"]',
    );
    expect(reconnect?.disabled).toBe(false);
    expect(reconnect?.className).toContain("size-7");
    expect(reconnect?.querySelector("svg")?.classList).toContain("size-4");
    const remove = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove account"]',
    );
    expect(remove?.className).toContain("size-7");
    expect(remove?.querySelector("svg")?.classList).toContain("size-4");
    await act(async () => reconnect?.click());

    expect(useConnectionsStore.getState().beginAuthorization).toHaveBeenCalledWith(
      "google",
      ["mail"],
      "/inbox",
    );
    expect(openProviderAuthorizationLink).toHaveBeenCalledWith(
      "https://accounts.google.test/reconnect",
    );
    expect(container.textContent).toContain("Finish reconnecting, then refresh Inbox");
    expect(container.textContent).not.toContain("Session expired");
    expect(useActivityStore.getState().allItems[0]).toMatchObject({
      kind: "failure",
      title: "Alex Gmail could not refresh",
      target: { kind: "route", href: "/inbox" },
    });
  });

  it("offers reconnect when an active account receives a live authorization failure", async () => {
    useInboxStore.setState({
      accounts: [
        {
          connection_id: "gmail-rejected",
          provider: "google",
          account_id: "google-account-1",
          display_name: "Alex Gmail",
          email: "alex@example.com",
          total: 0,
          unread: 0,
          status: "active",
        },
      ],
      accountErrors: {
        "gmail-rejected": "Reconnect this email account.",
      },
      accountErrorCodes: {
        "gmail-rejected": "mail_provider_authorization_failed",
      },
    });

    await act(async () => root.render(inboxSurface()));

    const configure = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Configure Gmail account alex@example.com"]',
    );
    expect(configure?.className).toContain("opacity-100");
    expect(configure?.getAttribute("title")).toBe("Reconnect account");
    await act(async () => configure?.click());

    expect(
      document.body.querySelector<HTMLButtonElement>('button[aria-label="Reconnect account"]')
        ?.disabled,
    ).toBe(false);
  });

  it("disables reconnect for an account without an Outlook mailbox", async () => {
    useInboxStore.setState({
      accounts: [
        {
          connection_id: "microsoft-no-mailbox",
          provider: "microsoft",
          account_id: "microsoft-account-1",
          display_name: "Microsoft account",
          email: "login@gmail.com",
          total: 0,
          unread: 0,
          status: "needs_attention",
          error_code: "mail_provider_mailbox_unavailable",
        },
      ],
      accountErrors: {
        "microsoft-no-mailbox": "This Microsoft account has no Outlook mailbox.",
      },
    });

    await act(async () => root.render(inboxSurface()));

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Configure Outlook account login@gmail.com"]',
        )
        ?.click(),
    );
    const reconnect = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Reconnect account"]',
    );
    expect(reconnect?.disabled).toBe(true);
  });

  it("collapses the Accounts section", async () => {
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
    await act(async () => root.render(inboxSurface()));

    expect(container.textContent).toContain("alex@example.com");
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Collapse Accounts"]')?.click(),
    );

    expect(container.textContent).not.toContain("alex@example.com");
    expect(container.querySelector('button[aria-label="Expand Accounts"]')).not.toBeNull();
  });

  it("removes an account from its configuration panel after confirmation", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const load = vi.fn().mockResolvedValue(undefined);
    useInboxStore.setState({
      load,
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
    useConnectionsStore.setState({ remove });
    await act(async () => root.render(inboxSurface()));

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Configure Gmail account alex@example.com"]',
        )
        ?.click(),
    );
    const removeMenuItem = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove account"]',
    );
    await act(async () => removeMenuItem?.click());

    const dialog = document.body.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("Remove this Gmail account?");
    const confirm = Array.from(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
      (button) => button.textContent?.trim() === "Remove",
    );
    await act(async () => confirm?.click());

    expect(remove).toHaveBeenCalledWith("gmail-1");
    expect(load).toHaveBeenCalledWith(true);
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
    await act(async () => root.render(inboxSurface()));

    expect(container.textContent).toContain("alex@example.com");
    expect(container.textContent).toContain("No messages here");
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label="Show message"]')?.disabled,
    ).toBe(true);
  });

  it("shows only accounts from the provider owned by this tab's route", async () => {
    useInboxStore.setState({
      selectedProvider: "google",
      accounts: [
        {
          connection_id: "gmail-1",
          provider: "google",
          account_id: "google-account-1",
          display_name: "Personal Gmail",
          email: "personal@example.com",
          total: 0,
          unread: 0,
        },
        {
          connection_id: "outlook-1",
          provider: "microsoft",
          account_id: "microsoft-account-1",
          display_name: "Work Outlook",
          email: "work@example.com",
          total: 0,
          unread: 0,
        },
      ],
    });

    await act(async () => root.render(inboxSurface("/inbox?provider=microsoft")));

    expect(container.textContent).not.toContain("personal@example.com");
    expect(container.textContent).toContain("work@example.com");
    expect(container.textContent).toContain("All inboxes");
    expect(container.querySelector('[data-mail-provider-icon="outlook"]')).not.toBeNull();
  });

  it("lists Important and Trash as first-class folders", async () => {
    useInboxStore.setState({ selectedProvider: "google", selectedFolderKind: "trash" });

    await act(async () => root.render(inboxSurface()));

    const sidebar = container.querySelector("[data-inbox-left-shelf]");
    const items = [...(sidebar?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const important = items.find((item) => item.textContent?.trim() === "Important");
    const trash = items.find((item) => item.textContent?.trim() === "Trash");

    expect(items.some((item) => item.textContent?.trim() === "More")).toBe(false);
    expect(important).toBeDefined();
    expect(trash).toBeDefined();
    expect(trash?.className).toContain("bg-charcoal-card");
    expect(sidebar?.querySelectorAll(".misty-active-marker-side, .misty-marker-host")).toHaveLength(
      0,
    );
  });

  it("toggles the account shelf from the bottom bar", async () => {
    await act(async () => root.render(inboxSurface()));

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

    await act(async () => root.render(inboxSurface()));

    const messageView = container.querySelector("[data-inbox-message-view]");
    expect(messageView?.getAttribute("data-state")).toBe("closed");
    expect(container.textContent).toContain("1–1 of 134");

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Show message"]')?.click();
    });
    expect(messageView?.getAttribute("data-state")).toBe("open");
    expect(container.querySelector('[data-testid="location-probe"]')?.textContent).toBe(
      "/inbox?view=message&thread=gmail-1%3Athread-1",
    );

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Back to inbox"]')?.click();
    });
    expect(messageView?.getAttribute("data-state")).toBe("closed");
    expect(container.querySelector('[data-testid="location-probe"]')?.textContent).toBe(
      "/inbox?view=list&thread=gmail-1%3Athread-1",
    );

    await act(async () => {
      root.render(inboxSurface("/inbox?view=list&thread=gmail-1%3Athread-1"));
    });
    expect(container.querySelector("[data-inbox-message-view]")?.getAttribute("data-state")).toBe(
      "closed",
    );
  });

  it("filters threads via quick filter chips and search bar", async () => {
    const thread1: InboxThread = {
      provider: "gmail",
      provider_id: "thread-1",
      account_id: "google-account-1",
      connectionId: "gmail-1",
      key: "gmail-1:thread-1",
      subject: "Important announcement",
      snippet: "Quarterly review",
      participants: [{ name: "Alice", email: "alice@example.com" }],
      labels: ["INBOX"],
      last_message_at: "2026-08-20T12:00:00Z",
      unread: true,
      starred: false,
      messages: [],
    };
    const thread2: InboxThread = {
      provider: "gmail",
      provider_id: "thread-2",
      account_id: "google-account-1",
      connectionId: "gmail-1",
      key: "gmail-1:thread-2",
      subject: "Dinner plans",
      snippet: "Pizza tonight?",
      participants: [{ name: "Bob", email: "bob@example.com" }],
      labels: ["INBOX"],
      last_message_at: "2026-08-19T12:00:00Z",
      unread: false,
      starred: true,
      messages: [
        {
          provider: "gmail",
          provider_id: "msg-2",
          account_id: "google-account-1",
          thread_id: "thread-2",
          subject: "Dinner plans",
          from: { name: "Bob", email: "bob@example.com" },
          to: [{ name: "Alex", email: "misty@example.com" }],
          cc: [],
          bcc: [],
          reply_to: [],
          sent_at: "2026-08-19T12:00:00Z",
          snippet: "Pizza tonight?",
          body: { text: "Pizza tonight?", had_html: false, truncated: false },
          labels: ["INBOX"],
          unread: false,
          starred: true,
          draft: false,
          attachments: [
            {
              provider: "gmail",
              provider_id: "att-1",
              account_id: "google-account-1",
              message_id: "msg-2",
              filename: "menu.pdf",
              content_type: "application/pdf",
              size: 1024,
              inline: false,
            },
          ],
        },
      ],
    };
    useInboxStore.setState({
      accountId: "account-1",
      loaded: true,
      threadsByConnection: { "gmail-1": [thread1, thread2] },
      estimatedTotalByConnection: { "gmail-1": 2 },
    });

    await act(async () => root.render(inboxSurface()));

    expect(container.textContent).toContain("Important announcement");
    expect(container.textContent).toContain("Dinner plans");
    expect(container.querySelector('svg[aria-label="Has attachments"]')).not.toBeNull();

    // Click Unread filter
    const unreadButton = container.querySelector<HTMLButtonElement>(
      'button[data-filter-chip="unread"]',
    );
    await act(async () => unreadButton?.click());

    expect(container.textContent).toContain("Important announcement");
    expect(container.textContent).not.toContain("Dinner plans");

    // Click Starred filter
    const starredButton = container.querySelector<HTMLButtonElement>(
      'button[data-filter-chip="starred"]',
    );
    await act(async () => starredButton?.click());

    expect(container.textContent).not.toContain("Important announcement");
    expect(container.textContent).toContain("Dinner plans");

    // Click Attachments filter
    const attachmentsButton = container.querySelector<HTMLButtonElement>(
      'button[data-filter-chip="attachments"]',
    );
    await act(async () => attachmentsButton?.click());

    expect(container.textContent).not.toContain("Important announcement");
    expect(container.textContent).toContain("Dinner plans");
  });
});
