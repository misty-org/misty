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

  it("clears the visible inbox when all activity is marked read", async () => {
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
          <ActivityMenu className="" />
        </MemoryRouter>,
      );
    });

    expect(host.textContent).toContain("Needs attention");
    expect(host.textContent).not.toContain("Already read");

    const markAllRead = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "Mark all read",
    );
    await act(async () => markAllRead?.click());

    expect(host.textContent).not.toContain("Needs attention");
    expect(host.textContent).toContain("Nothing new.");
    expect(useActivityStore.getState().allItems.every((item) => item.readAt)).toBe(true);
    expect(mocks.markInboxSeen).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
  });

  it("offers Mark all read for unread non-attention activity", async () => {
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
          <ActivityMenu className="" />
        </MemoryRouter>,
      );
    });

    expect(useActivityStore.getState().attentionCount).toBe(0);
    expect(host.textContent).toContain("Mark all read");

    await act(async () => root.unmount());
  });
});

function activityFixture(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: "unread",
    accountId: "account-1",
    source: "spaces",
    sourceId: "unread",
    kind: "failure",
    title: "Needs attention",
    body: "Reconnect this account.",
    createdAt: "2026-08-28T19:00:00.000Z",
    attention: true,
    target: { kind: "none" },
    ...overrides,
  };
}
