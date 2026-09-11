import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { expect, it, vi } from "vitest";
vi.mock("@/features/auth", () => ({ useAuth: () => ({ user: { id: "one" } }) }));
vi.mock("./nativeNotifications", () => ({
  publishNativeActivity: vi.fn(),
  syncNativeBadge: vi.fn(),
}));
vi.mock("@/features/spaces", () => ({
  useSpacesStore: {
    getState: () => ({ loadInbox: async () => {}, markInboxSeen: async () => {} }),
  },
}));
import { ActivityPanel } from "./ActivityPanel";
import { ActivityMenu } from "@/application/layouts/DesktopLayout/ActivityMenu";
import { openActivityPanel, closeActivityPanel, useActivityPanel } from "./activityPanelState";
function Workspace() {
  return <p data-testid="workspace">{useLocation().pathname}</p>;
}

it("opens above the current workspace and closes without changing its route", async () => {
  closeActivityPanel();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={["/apps/files"]}>
          <Workspace />
          <ActivityMenu className="" />
          <ActivityPanel />
        </MemoryRouter>,
      ),
    );
    await act(async () => host.querySelector<HTMLButtonElement>('[title="Activity"]')?.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Activity");
    expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
    expect(document.querySelector('[aria-label="Filter activity"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="workspace"]')?.textContent).toBe("/apps/files");
    const close = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ).find((button) => button.textContent === "Close");
    await act(async () => close?.click());
    expect(useActivityPanel.getState().open).toBe(false);
    expect(host.querySelector('[data-testid="workspace"]')?.textContent).toBe("/apps/files");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    closeActivityPanel();
  }
});

it("keeps request destinations inside the panel", () => {
  openActivityPanel("/activity?approval=approval-1");
  expect(useActivityPanel.getState()).toMatchObject({ open: true, approvalId: "approval-1" });
  openActivityPanel("/activity?intervention=wait-1");
  expect(useActivityPanel.getState()).toMatchObject({
    open: true,
    approvalId: undefined,
    interventionId: "wait-1",
  });
  closeActivityPanel();
});
