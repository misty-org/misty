import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as GlobalMistyApi from "../globalMistyApi";

vi.mock("../globalMistyApi", async (importOriginal) => {
  const original = await importOriginal<typeof GlobalMistyApi>();
  return {
    ...original,
    globalMistyApi: {
      ...original.globalMistyApi,
      conversations: vi.fn().mockResolvedValue({ conversations: [] }),
    },
  };
});

import { GlobalMisty } from "../GlobalMisty";
import { useGlobalSearchStore } from "../useGlobalSearchStore";

describe("GlobalMisty", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    useGlobalSearchStore.getState().setAccount("");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("shows contextual actions, cycles mode with Tab, and expands when typing", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/home"]}>
          <GlobalMisty
            accountId="account-1"
            currentPath="/home"
            activePaneId=""
            activePanePath=""
          />
        </MemoryRouter>,
      );
    });

    expect(
      container.querySelector('[aria-label="Open Misty — Search, Ask, or Action"]'),
    ).toBeNull();
    await act(async () => useGlobalSearchStore.getState().activateLauncher());

    const launcher = container.querySelector<HTMLElement>(
      '[aria-label="Open Misty — Search, Ask, or Action"]',
    );
    expect(launcher).not.toBeNull();
    expect(launcher?.textContent).toContain("Summarize updates");
    expect(launcher?.textContent).toContain("Create task");
    await act(async () => launcher?.click());

    const compactInput = container.querySelector<HTMLInputElement>(
      "[data-global-misty-launcher-input]",
    );
    expect(document.activeElement).toBe(compactInput);
    expect(container.querySelector('[aria-label="Misty Search, Ask, and Action"]')).toBeNull();

    await act(async () => {
      compactInput?.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(useGlobalSearchStore.getState().mode).toBe("ask");

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(compactInput, "l");
      compactInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(container.textContent).toContain("Search");
    expect(container.textContent).toContain("Ask");
    expect(container.textContent).toContain("Action");

    const expandedInput = container.querySelector<HTMLInputElement>(
      '[aria-label="Ask with Misty"]',
    );
    expect(document.activeElement).toBe(expandedInput);
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(expandedInput, "");
      expandedInput?.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(useGlobalSearchStore.getState().open).toBe(false);
    expect(useGlobalSearchStore.getState().launcherOpen).toBe(true);
    expect(
      container.querySelector('[aria-label="Open Misty — Search, Ask, or Action"]'),
    ).not.toBeNull();
    expect(useGlobalSearchStore.getState().query).toBe("");
  });
});
