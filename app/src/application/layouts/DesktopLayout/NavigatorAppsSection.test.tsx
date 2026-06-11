import { DEFAULT_NAVIGATOR_APP_IDS, useNavigatorAppsStore } from "@/features/workspace";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NavigatorAppsSection } from "./NavigatorAppsSection";

describe("NavigatorAppsSection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    useNavigatorAppsStore.setState({ appIdsByAccount: {}, collapsedByAccount: {} });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
  });

  it("opens a searchable checklist and updates the sidebar selection", async () => {
    await renderSection();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Add app"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
      await Promise.resolve();
    });

    const search = document.body.querySelector<HTMLInputElement>('input[aria-label="Search apps"]');
    expect(search).not.toBeNull();
    expect(
      document.body.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.textContent,
    ).toContain("Inbox");
    expect(document.body.querySelector('[data-app-icon="home"]')).toBeNull();

    const browser = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("BrowserBrowse the web in Misty"),
    );
    expect(browser?.getAttribute("aria-pressed")).toBe("false");
    await act(async () => browser?.click());
    expect(useNavigatorAppsStore.getState().appIdsByAccount["account-1"]).toContain("browser");

    await act(async () => {
      if (search) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
          search,
          "terminal",
        );
        search.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    expect(document.body.textContent).toContain("Run commands locally");
    expect(document.body.textContent).not.toContain("Browse the web in Misty");
    expect(document.body.querySelector('a[href="/marketplace"]')?.textContent).toBe("Browse apps");
  });

  it("collapses the app list and preserves the choice", async () => {
    await renderSection();
    expect(container.textContent).toContain("Visible apps");

    const controls = container.querySelector('[role="group"][aria-label="Apps controls"]');
    expect(controls?.className).toContain("pl-2.5");
    expect(controls?.className).toContain("pr-0");
    expect(controls?.className).toContain("w-full");
    expect(controls?.className).not.toContain("px-2.5");

    const addAppButton = container.querySelector<HTMLButtonElement>('button[aria-label="Add app"]');
    expect(addAppButton?.className).toContain("ml-auto");
    expect(addAppButton?.querySelector("svg")?.classList.contains("!size-3.5")).toBe(true);

    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label="Collapse Apps"]')?.className,
    ).toContain("text-[13px]");

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Collapse Apps"]')?.click();
    });

    expect(container.textContent).not.toContain("Visible apps");
    expect(useNavigatorAppsStore.getState().collapsedByAccount["account-1"]).toBe(true);
    expect(container.querySelector('button[aria-label="Expand Apps"]')).not.toBeNull();
  });

  async function renderSection() {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <NavigatorAppsSection accountId="account-1">
            <span>Visible apps</span>
          </NavigatorAppsSection>
        </MemoryRouter>,
      );
    });
    expect(DEFAULT_NAVIGATOR_APP_IDS).toHaveLength(5);
  }
});
