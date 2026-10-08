import { createBrowserViewState, type WorkspaceView } from "@/features/workspace";
import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useExtensionsStore } from "@/features/extensions/store";
import { useBrowserRuntimeStore } from "./browserRuntime";
import { BrowserWorkspace } from "./BrowserWorkspace";
const invoke = vi.hoisted(() =>
  vi.fn<(command: string, args?: unknown) => Promise<unknown>>(async (command) =>
    ["browser_downloads_list", "browser_downloads_progress", "browser_history_suggest"].includes(
      command,
    )
      ? []
      : undefined,
  ),
);
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => vi.fn()) }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke,
}));
const browserTab: WorkspaceView = {
  id: "tab:browser",
  surfaceId: "browser",
  groupKey: "tool:browser",
  instanceKey: "browser:one",
  title: "New Tab",
  route: "/browser",
  sidebarVisible: true,
  state: createBrowserViewState(),
  createdAt: 1,
  lastFocusedAt: 1,
};
// The extensions toolbar links to the Extensions page.
const view = (tab: WorkspaceView) => (
  <MemoryRouter>
    <BrowserWorkspace tab={tab} />
  </MemoryRouter>
);
describe("BrowserWorkspace", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    invoke.mockClear();
    // The desktop Browser waits for extensions to load before showing pages.
    useExtensionsStore.setState({ ready: true });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    useBrowserRuntimeStore.getState().removeTab(browserTab.id);
    delete (
      window as typeof window & {
        __TAURI_INTERNALS__?: unknown;
      }
    ).__TAURI_INTERNALS__;
    container.remove();
  });
  it("keeps the native page interactive when no app overlay is open", async () => {
    (
      window as typeof window & {
        __TAURI_INTERNALS__?: {
          invoke: () => void;
        };
      }
    ).__TAURI_INTERNALS__ = {
      invoke: () => undefined,
    };
    await act(async () => root.render(view(browserTab)));
    expect(document.documentElement.hasAttribute("data-browser-overlay-active")).toBe(false);
    expect(invoke).not.toHaveBeenCalledWith("browser_webviews_set_overlay_active", {
      active: true,
    });
  });
  it("leaves cursor ownership with the native page webview", async () => {
    (
      window as typeof window & {
        __TAURI_INTERNALS__?: {
          invoke: () => void;
        };
      }
    ).__TAURI_INTERNALS__ = {
      invoke: () => undefined,
    };
    await act(async () => root.render(view(browserTab)));
    expect(container.querySelector<HTMLElement>("[data-browser-page-host]")?.style.cursor).toBe("");
  });
  it("hides the previous native page when switching browser tabs", async () => {
    (
      window as typeof window & {
        __TAURI_INTERNALS__?: {
          invoke: () => void;
        };
      }
    ).__TAURI_INTERNALS__ = {
      invoke: () => undefined,
    };
    const nextTab: WorkspaceView = {
      ...browserTab,
      id: "tab:google",
      instanceKey: "browser:google",
      title: "Google",
      state: createBrowserViewState("https://google.com"),
    };
    await act(async () => root.render(view(browserTab)));
    invoke.mockClear();
    await act(async () => root.render(view(nextTab)));
    expect(invoke).toHaveBeenCalledWith("browser_webview_hide", {
      request: {
        id: "tab-browser-one",
      },
    });
  });
  it("keeps Browser chrome on the tab surface and its page host on the page's color", async () => {
    await act(async () => root.render(view(browserTab)));
    expect(
      container.querySelector<HTMLElement>("[data-browser-toolbar]")?.style.backgroundColor,
    ).toBe("var(--workspace-tab-surface)");
    expect(
      container.querySelector<HTMLElement>("[data-browser-page-host]")?.style.backgroundColor,
    ).toBe("var(--browser-page-background, var(--workspace-tab-surface))");
  });
  it("never embeds a website frame when the native Browser runtime is unavailable", async () => {
    const webTab = {
      ...browserTab,
      title: "Google",
      state: createBrowserViewState("https://www.google.com/"),
    };
    await act(async () => root.render(view(webTab)));
    expect(container.querySelector("iframe")).toBeNull();
    expect(
      container.querySelector('[data-testid="browser-native-runtime-required"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("Open this page in the Misty desktop app");
    expect(container.textContent).toContain("Open in browser");
  });
  it("renders browser controls without a nested browser tab strip", () => {
    act(() => root.render(view(browserTab)));
    const workspace = container.querySelector("[data-browser-workspace-tab]");
    expect(workspace).not.toBeNull();
    expect(workspace?.classList.contains("grid-rows-[44px_minmax(0,1fr)]")).toBe(false);
    expect(workspace?.classList.contains("grid-rows-[44px_auto_minmax(0,1fr)]")).toBe(true);
    const omnibox = container.querySelector('[aria-label="Search or enter address"]');
    expect(omnibox).not.toBeNull();
    expect(omnibox?.closest("form")?.classList.contains("relative")).toBe(true);
    expect(container.querySelector('[aria-label="Misty"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Extensions"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Bookmark this page"]')?.closest("form")).toBe(
      omnibox?.closest("form"),
    );
    expect(container.querySelector('[aria-label="Annotate page"]')).toBeNull();
    expect(container.querySelector('[aria-label^="Viewport"]')).toBeNull();
    expect(container.querySelector('[aria-label="New tab"]')).toBeNull();
    expect(container.querySelector('[aria-label^="Close "]')).toBeNull();
  });
  it("quietly identifies browser tabs owned by Misty's current work", () => {
    const agentOwnedTab: WorkspaceView = {
      ...browserTab,
      title: "Misty research · family activities",
      state: {
        ...createBrowserViewState("https://www.google.com/search?q=family+activities"),
        agentOwned: true,
      },
    };
    act(() => root.render(view(agentOwnedTab)));
    const ownershipMarker = container.querySelector<HTMLElement>(
      '[title="This browser tab is scoped to Misty\'s current work"]',
    );
    expect(ownershipMarker?.textContent?.trim()).toBe("Misty");
  });
  it("opens the page annotation toolkit from the menu and closes it without navigating", async () => {
    await act(async () => root.render(view(browserTab)));
    const trigger = container.querySelector<HTMLElement>('[aria-label="Browser menu"]');
    await act(async () => {
      openMenu(trigger);
      await settleBrowserOverlay();
    });
    const moreTools = [
      ...document.body.querySelectorAll<HTMLElement>('[data-browser-menu] [role="menuitem"]'),
    ].find((item) => item.textContent?.trim().startsWith("More tools"));
    await act(async () => {
      moreTools?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      await settleBrowserOverlay();
    });
    const annotate = [
      ...document.body.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]'),
    ].find((item) => item.textContent?.trim() === "Annotate page");
    expect(annotate).toBeDefined();
    await act(async () => annotate?.click());
    expect(container.querySelector('[aria-label="Browser annotation canvas"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Pen"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Rectangle"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Text"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Clear annotations"]')).not.toBeNull();
    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.trim() === "Close")
        ?.click();
    });
    expect(container.querySelector('[aria-label="Browser annotation canvas"]')).toBeNull();
  });
  it("selects the complete address when the omnibox receives focus", async () => {
    const tab = {
      ...browserTab,
      state: createBrowserViewState("https://example.com/path?q=misty"),
    };
    await act(async () => root.render(view(tab)));
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
  it("shows the current page on focus, then direct and web-search suggestions while typing", async () => {
    const tab = {
      ...browserTab,
      state: createBrowserViewState("https://youtube.com/watch?v=misty"),
    };
    await act(async () => root.render(view(tab)));
    const input = container.querySelector<HTMLInputElement>(
      '[aria-label="Search or enter address"]',
    );
    await act(async () => {
      input?.focus();
      await settleBrowserOverlay();
    });
    const focusedOptions = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(focusedOptions.map((option) => option.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("youtube.com")]),
    );
    await act(async () => {
      fireEvent.change(input!, { target: { value: "vimeo.com" } });
      await settleBrowserOverlay();
    });
    const options = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(options.map((option) => option.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("vimeo.com")]),
    );
    expect(options.map((option) => option.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("Search with Google")]),
    );
  });
  it("opens a functional browser menu", async () => {
    await act(async () => root.render(view(browserTab)));
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Browser menu"]');
    await act(async () => {
      openMenu(trigger);
      await settleBrowserOverlay();
    });
    const menuItems = [
      ...document.body.querySelectorAll<HTMLElement>('[data-browser-menu] [role="menuitem"]'),
    ].map((item) => item.textContent?.trim() ?? "");
    for (const label of [
      "New tab",
      "History",
      "Downloads",
      "Find…",
      "Print…",
      "More tools",
      "Open in default browser",
      "Extensions",
      "Settings",
    ]) {
      expect(
        menuItems.some((item) => item.startsWith(label)),
        label,
      ).toBe(true);
    }
    expect(menuItems.some((item) => item.startsWith("Reload"))).toBe(false);
    // Bookmarks live in search (!bookmarks); the star and Cmd+D still save a page.
    expect(menuItems.some((item) => item.startsWith("Bookmarks"))).toBe(false);
  });
  it("waits for native sibling order before mounting browser popups", async () => {
    (
      window as typeof window & {
        __TAURI_INTERNALS__?: {
          invoke: () => void;
        };
      }
    ).__TAURI_INTERNALS__ = {
      invoke: () => undefined,
    };
    let releaseRestack: (() => void) | undefined;
    invoke.mockImplementation((command, args) => {
      const active = (
        args as
          | {
              active?: boolean;
            }
          | undefined
      )?.active;
      if (command === "browser_webviews_set_overlay_active" && active === true) {
        return new Promise<void>((resolve) => {
          releaseRestack = resolve;
        });
      }
      return Promise.resolve(
        [
          "browser_downloads_list",
          "browser_downloads_progress",
          "browser_history_suggest",
        ].includes(command)
          ? []
          : undefined,
      );
    });
    await act(async () => root.render(view(browserTab)));
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Browser menu"]');
    await act(async () => {
      openMenu(trigger);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
    });
    expect(document.body.querySelector("[data-browser-menu]")).toBeNull();
    await act(async () => {
      releaseRestack?.();
      await settleBrowserOverlay();
    });
    expect(document.body.querySelector("[data-browser-menu]")).not.toBeNull();
  });
});

/** Radix menus open on pointer down, not click. */
function openMenu(trigger: HTMLElement | null) {
  trigger?.dispatchEvent(
    new MouseEvent("pointerdown", {
      bubbles: true,
      button: 0,
    }),
  );
}
async function settleBrowserOverlay() {
  await new Promise<void>((resolve) => window.setTimeout(resolve, 60));
}
