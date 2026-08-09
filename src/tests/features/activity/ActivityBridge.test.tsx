import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ user: { id: "account-1" } }),
}));

vi.mock("@/features/activity/nativeNotifications", () => ({
  publishNativeActivity: vi.fn(async () => false),
  syncNativeBadge: vi.fn(async () => undefined),
}));

import { ActivityBridge } from "@/features/activity/ActivityBridge";
import { useActivityStore } from "@/features/activity/useActivityStore";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";

describe("ActivityBridge", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    useActivityStore.persist.clearStorage();
    useActivityStore.setState({
      accountId: "account-1",
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
    useSpacesStore.setState({
      inbox: { unreads: [], mentions: [] },
      invitations: [],
      loadInbox: vi.fn(async () => undefined),
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("renders no centralized UI and clears an update on its owning page", async () => {
    useActivityStore.getState().ingestLocal({
      id: "file-error",
      kind: "failure",
      title: "File action needs attention",
      target: { kind: "workspace-tool", tool: "files" },
      notify: false,
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/files"]}>
          <ActivityBridge />
        </MemoryRouter>,
      );
      await Promise.resolve();
    });

    expect(container.childElementCount).toBe(0);
    expect(useActivityStore.getState().allItems[0]?.readAt).toBeTruthy();
  });
});
