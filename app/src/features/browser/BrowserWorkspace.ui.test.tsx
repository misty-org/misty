import { createBrowserTabState, type WorkspaceTab } from "@/features/workspace";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrowserWorkspace } from "./BrowserWorkspace";

const browserTab: WorkspaceTab = {
  id: "tab:browser",
  surfaceId: "browser",
  groupKey: "tool:browser",
  instanceKey: "browser:one",
  title: "New Tab",
  route: "/browser",
  sidebarVisible: true,
  state: createBrowserTabState(),
  createdAt: 1,
  lastFocusedAt: 1,
};

describe("BrowserWorkspace", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders browser controls without a nested browser tab strip", () => {
    act(() => root.render(<BrowserWorkspace tab={browserTab} />));

    const workspace = container.querySelector("[data-browser-workspace-tab]");
    expect(workspace).not.toBeNull();
    expect(workspace?.classList.contains("grid-rows-[44px_minmax(0,1fr)]")).toBe(true);
    expect(workspace?.classList.contains("grid-rows-[44px_auto_minmax(0,1fr)]")).toBe(false);
    expect(container.querySelector('[aria-label="Search or enter address"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="New tab"]')).toBeNull();
    expect(container.querySelector('[aria-label^="Close "]')).toBeNull();
  });

  it("selects the complete address when the omnibox receives focus", async () => {
    const tab = {
      ...browserTab,
      state: createBrowserTabState("https://example.com/path?q=misty"),
    };
    await act(async () => root.render(<BrowserWorkspace tab={tab} />));

    const input = container.querySelector<HTMLInputElement>(
      '[aria-label="Search or enter address"]',
    );
    await act(async () => {
      input?.focus();
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });

    expect(input?.value).toBe("https://example.com/path?q=misty");
    expect(input?.selectionStart).toBe(0);
    expect(input?.selectionEnd).toBe(input?.value.length);
  });

  it("opens a functional browser menu", async () => {
    await act(async () => root.render(<BrowserWorkspace tab={browserTab} />));

    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Browser menu"]');
    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    });

    const menuItems = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].map(
      (item) => item.textContent?.trim(),
    );
    expect(menuItems).toContain("Reload");
    expect(menuItems).toContain("Copy address");
    expect(menuItems).toContain("Open in default browser");
  });
});
