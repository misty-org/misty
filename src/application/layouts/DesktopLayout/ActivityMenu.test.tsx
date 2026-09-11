import { ActivityFeed } from "@/features/activity/ActivityFeed";
import { ActivityPanelFooter } from "@/features/activity/ActivityPanelFooter";
import { defaultActivityView, selectActivityView } from "@/features/activity/activityView";
function TestFooter() {
  const state = useActivityStore();
  return <ActivityPanelFooter results={selectActivityView(state.allItems, defaultActivityView)} />;
}
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityItem } from "@/features/activity";
import type * as SharedUI from "@/shared/ui";

const mocks = vi.hoisted(() => ({
  markInboxSeen: vi.fn(async () => undefined),
}));

vi.mock("@/features/spaces", () => ({
  useSpacesStore: {
    getState: () => ({
      markInboxSeen: mocks.markInboxSeen,
      loadInbox: vi.fn(async () => undefined),
    }),
  },
}));

vi.mock("@/features/activity/nativeNotifications", () => ({
  publishNativeActivity: vi.fn(async () => true),
  syncNativeBadge: vi.fn(async () => undefined),
}));

vi.mock("@/shared/ui", async (importOriginal) => {
  const original = await importOriginal<typeof SharedUI>();
  return {
    ...original,
    Popover: ({ children }: { children: React.ReactNode }) => children,
    PopoverTrigger: ({ children }: { children: React.ReactNode }) => children,
    PopoverContent: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="activity-popover">{children}</div>
    ),
  };
});

import { useActivityStore } from "@/features/activity";
import { ActivityMenu } from "./ActivityMenu";

describe("ActivityMenu", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    useActivityStore.persist.clearStorage();
    useActivityStore.setState(useActivityStore.getInitialState(), true);
    useActivityStore.setState({
      accountId: "",
      sourceItems: [],
      localItems: [],
      readAtByKey: {},
      knownSourceIdsByAccount: {},
      baselinedAccounts: [],
      allItems: [],
      attentionItems: [],
      attentionCount: 0,
      loading: false,
      offline: false,
      error: null,
    });
    mocks.markInboxSeen.mockClear();
  });

  it("retains updates in the unified feed when marked read", async () => {
    useActivityStore.getState().setAccount("account-1");
    useActivityStore.getState().syncSources("account-1", [
      activityFixture({ id: "unread", sourceId: "unread", title: "Needs attention" }),
      activityFixture({
        id: "read",
        sourceId: "read",
        title: "Already read",
        readAt: "2026-08-28T12:00:00.000Z",
      }),
    ]);

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <MemoryRouter>
          <>
            <ActivityMenu className="" />
            <TestFooter />
            <ActivityFeed />
          </>
        </MemoryRouter>,
      );
    });

    expect(host.textContent).toContain("Needs attention");
    expect(host.textContent).toContain("Already read");

    const markAllRead = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "Mark all read",
    );
    await act(async () => markAllRead?.click());

    expect(host.textContent).toContain("Needs attention");
    expect(useActivityStore.getState().attentionCount).toBe(0);
    expect(useActivityStore.getState().allItems.every((item) => item.readAt)).toBe(true);
    expect(mocks.markInboxSeen).not.toHaveBeenCalled();

    await act(async () => root.unmount());
  });

  it("checking the unified feed preserves pending requests and later arrivals restore the dot", async () => {
    const state = () => useActivityStore.getState();
    state().setAccount("account-1");
    state().ingestLocal({ id: "request", kind: "failure", title: "Export blocked" });
    state().ingestLocal({ id: "history", kind: "system", title: "Shared update" });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <MemoryRouter>
          <>
            <ActivityMenu className="" />
            <TestFooter />
            <ActivityFeed />
          </>
        </MemoryRouter>,
      ),
    );
    expect(host.querySelector('[aria-label="Activity, 1 needing attention"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="activity-history-dot"]')).toBeNull();
    expect(state().attentionCount).toBe(1);
    expect(state().hasUnseenHistory).toBe(false);
    await act(async () => {
      state().ingestLocal({
        id: "request",
        kind: "failure",
        status: "resolved",
        title: "Approved",
      });
    });
    expect(host.querySelector('[data-testid="activity-history-dot"]')).not.toBeNull();
    await act(async () => state().markHistoryChecked());
    expect(host.querySelector('[data-testid="activity-history-dot"]')).toBeNull();
    await act(async () => root.unmount());
  });

  it("shows a single checkmark for a saved action error and clears it on reading", async () => {
    useActivityStore.getState().setAccount("account-1");
    useActivityStore.setState({
      localItems: [
        activityFixture({
          id: "legacy",
          source: "device",
          sourceId: "system-error:global-search:request:hash",
          kind: "failure",
          title: "Misty request could not be completed",
        }),
      ],
    });
    useActivityStore.getState().setAccount("account-1");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <MemoryRouter>
          <>
            <ActivityMenu className="" />
            <TestFooter />
            <ActivityFeed />
          </>
        </MemoryRouter>,
      ),
    );
    const read = host.querySelector<HTMLButtonElement>(
      '[aria-label="Mark update read: Misty request could not be completed"]',
    );
    expect(read).not.toBeNull();
    expect(read?.querySelector("svg")).not.toBeNull();
    expect(host.textContent).toContain("Mark all read");
    await act(async () => read?.click());
    expect(useActivityStore.getState().attentionCount).toBe(0);
    await act(async () => root.unmount());
  });
  it("offers Mark updates read for unread non-attention activity", async () => {
    useActivityStore.getState().setAccount("account-1");
    useActivityStore.getState().syncSources("account-1", [
      activityFixture({
        id: "completion",
        sourceId: "completion",
        kind: "completion",
        title: "Transfer finished",
        attention: false,
      }),
    ]);

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <MemoryRouter>
          <>
            <ActivityMenu className="" />
            <TestFooter />
            <ActivityFeed />
          </>
        </MemoryRouter>,
      );
    });

    expect(useActivityStore.getState().attentionCount).toBe(1);
    expect(host.textContent).toContain("Mark all read");
    const markRead = host.querySelector<HTMLButtonElement>(
      '[aria-label="Mark update read: Transfer finished"]',
    );
    expect(markRead?.title).toBe("Mark read");
    await act(async () => markRead?.click());
    expect(useActivityStore.getState().attentionCount).toBe(0);
    expect(useActivityStore.getState().allItems[0].readAt).toBeTruthy();

    await act(async () => root.unmount());
  });
});

function activityFixture(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: "unread",
    accountId: "account-1",
    source: "spaces",
    sourceId: "unread",
    kind: "mention",
    title: "Needs attention",
    body: "Reconnect this account.",
    createdAt: "2026-08-28T19:00:00.000Z",
    attention: true,
    target: { kind: "none" },
    ...overrides,
  };
}
