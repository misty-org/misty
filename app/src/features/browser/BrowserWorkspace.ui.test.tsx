import { createBrowserTabState, type WorkspaceTab } from "@/features/workspace";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBrowserRuntimeStore } from "./browserRuntime";
import { BrowserWorkspace } from "./BrowserWorkspace";

const invoke = vi.hoisted(() =>
  vi.fn<(command: string, args?: unknown) => Promise<unknown>>(async () => undefined),
);

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

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
    invoke.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    useBrowserRuntimeStore.getState().removeTab(browserTab.id);
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    container.remove();
  });

  it("keeps the native page interactive when no app overlay is open", async () => {
    (
      window as typeof window & { __TAURI_INTERNALS__?: { invoke: () => void } }
    ).__TAURI_INTERNALS__ = {
      invoke: () => undefined,
    };
    await act(async () => root.render(<BrowserWorkspace tab={browserTab} />));

    expect(document.documentElement.hasAttribute("data-browser-overlay-active")).toBe(false);
    expect(invoke).not.toHaveBeenCalledWith("browser_webviews_set_overlay_active", {
      active: true,
    });
  });

  it("leaves cursor ownership with the native page webview", async () => {
    (
      window as typeof window & { __TAURI_INTERNALS__?: { invoke: () => void } }
    ).__TAURI_INTERNALS__ = {
      invoke: () => undefined,
    };
    await act(async () => root.render(<BrowserWorkspace tab={browserTab} />));

    expect(container.querySelector<HTMLElement>("[data-browser-page-host]")?.style.cursor).toBe("");
  });

  it("keeps Browser chrome and its backing surface dark across page colors", async () => {
    await act(async () => root.render(<BrowserWorkspace tab={browserTab} />));

    expect(
      container.querySelector<HTMLElement>("[data-browser-toolbar]")?.style.backgroundColor,
    ).toBe("rgb(24, 25, 28)");
    expect(
      container.querySelector<HTMLElement>("[data-browser-page-host]")?.style.backgroundColor,
    ).toBe("rgb(24, 25, 28)");
  });

  it("renders browser controls without a nested browser tab strip", () => {
    act(() => root.render(<BrowserWorkspace tab={browserTab} />));

    const workspace = container.querySelector("[data-browser-workspace-tab]");
    expect(workspace).not.toBeNull();
    expect(workspace?.classList.contains("grid-rows-[44px_minmax(0,1fr)]")).toBe(true);
    expect(workspace?.classList.contains("grid-rows-[44px_auto_minmax(0,1fr)]")).toBe(false);
    const omnibox = container.querySelector('[aria-label="Search or enter address"]');
    expect(omnibox).not.toBeNull();
    expect(omnibox?.closest("form")?.classList.contains("relative")).toBe(true);
    expect(container.querySelector('[aria-label="Annotate page"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Viewport: Responsive"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="New tab"]')).toBeNull();
    expect(container.querySelector('[aria-label^="Close "]')).toBeNull();
  });

  it("opens the page annotation toolkit and closes it without navigating", async () => {
    await act(async () => root.render(<BrowserWorkspace tab={browserTab} />));

    const annotate = container.querySelector<HTMLButtonElement>('[aria-label="Annotate page"]');
    await act(async () => annotate?.click());

    expect(container.querySelector('[aria-label="Browser annotation canvas"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Pen"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Rectangle"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Text"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Clear annotations"]')).not.toBeNull();
    expect(annotate?.getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.trim() === "Close")
        ?.click();
    });
    expect(container.querySelector('[aria-label="Browser annotation canvas"]')).toBeNull();
  });

  it("offers desktop, tablet, and mobile viewport presets", async () => {
    await act(async () => root.render(<BrowserWorkspace tab={browserTab} />));

    const viewport = container.querySelector<HTMLButtonElement>(
      '[aria-label="Viewport: Responsive"]',
    );
    await act(async () => {
      viewport?.click();
      await settleBrowserOverlay();
    });
    const mobile = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Mobile"),
    );
    expect(mobile).toBeDefined();
    expect(document.body.textContent).toContain("Desktop");
    expect(document.body.textContent).toContain("Tablet");
    expect(document.body.textContent).toContain("390 px");
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
      await settleBrowserOverlay();
    });

    expect(input?.value).toBe("https://example.com/path?q=misty");
    expect(input?.selectionStart).toBe(0);
    expect(input?.selectionEnd).toBe(input?.value.length);
  });

  it("shows direct, history, and web-search omnibox suggestions", async () => {
    const tab = {
      ...browserTab,
      state: createBrowserTabState("https://youtube.com/watch?v=misty"),
    };
    await act(async () => root.render(<BrowserWorkspace tab={tab} />));

    const input = container.querySelector<HTMLInputElement>(
      '[aria-label="Search or enter address"]',
    );
    await act(async () => {
      input?.focus();
      await settleBrowserOverlay();
    });

    const options = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(options.some((option) => option.textContent?.includes("youtube.com"))).toBe(true);
    expect(options.some((option) => option.textContent?.includes("Search with Google"))).toBe(true);
  });

  it("opens a functional browser menu", async () => {
    await act(async () => root.render(<BrowserWorkspace tab={browserTab} />));

    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Browser menu"]');
    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
      await settleBrowserOverlay();
    });

    const menuItems = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].map(
      (item) => item.textContent?.trim(),
    );
    expect(menuItems).toContain("Reload");
    expect(menuItems).toContain("Copy address");
    expect(menuItems).toContain("Open in default browser");
  });

  it("waits for native sibling order before mounting browser popups", async () => {
    (
      window as typeof window & { __TAURI_INTERNALS__?: { invoke: () => void } }
    ).__TAURI_INTERNALS__ = {
      invoke: () => undefined,
    };
    let releaseRestack: (() => void) | undefined;
    invoke.mockImplementation((command, args) => {
      const active = (args as { active?: boolean } | undefined)?.active;
      if (command === "browser_webviews_set_overlay_active" && active === true) {
        return new Promise<void>((resolve) => {
          releaseRestack = resolve;
        });
      }
      return Promise.resolve(undefined);
    });
    await act(async () => root.render(<BrowserWorkspace tab={browserTab} />));

    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Browser menu"]');
    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
      await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
    });
    expect(document.body.querySelector('[role="menu"]')).toBeNull();

    await act(async () => {
      releaseRestack?.();
      await settleBrowserOverlay();
    });
    expect(document.body.querySelector('[role="menu"]')).not.toBeNull();
  });
});

async function settleBrowserOverlay() {
  await new Promise<void>((resolve) => window.setTimeout(resolve, 60));
}
