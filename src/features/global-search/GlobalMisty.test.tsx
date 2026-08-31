import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as GlobalMistyApi from "./globalMistyApi";

vi.mock("./globalMistyApi", async (importOriginal) => {
  const original = await importOriginal<typeof GlobalMistyApi>();
  return {
    ...original,
    globalMistyApi: {
      ...original.globalMistyApi,
      conversations: vi.fn().mockResolvedValue({ conversations: [] }),
    },
  };
});

import { GlobalMisty } from "./GlobalMisty";
import { useGlobalSearchStore } from "./useGlobalSearchStore";

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

  it("keeps one stable input while search results expand beneath it", async () => {
    const requestDrag = vi.fn();
    const switchToPet = vi.fn();
    const contentVisibilityChanged = vi.fn();
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/home"]}>
          <GlobalMisty
            accountId="account-1"
            currentPath="/home"
            activePaneId=""
            activePanePath=""
            onRequestDrag={requestDrag}
            onSwitchToPet={switchToPet}
            onContentVisibilityChange={contentVisibilityChanged}
          />
        </MemoryRouter>,
      );
    });

    await act(async () => useGlobalSearchStore.getState().activateLauncher());

    const input = container.querySelector<HTMLTextAreaElement>(
      "[data-global-misty-launcher-input]",
    );
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    expect(container.querySelector('[aria-label="Misty Search"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Search or Ask"]')).not.toBeNull();
    expect(
      container
        .querySelector<HTMLButtonElement>('[data-misty-mode="search"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(container.querySelector('[aria-label="Misty candidates"]')).toBeNull();
    expect(container.querySelector('[aria-label="Search filters"]')).toBeNull();
    expect(contentVisibilityChanged).toHaveBeenLastCalledWith(false);

    const dragHandle = container.querySelector<HTMLElement>("[data-misty-panel-drag-handle]");
    expect(dragHandle?.className).toContain("opacity-100");
    expect(dragHandle?.className).toContain("pointer-events-auto");
    expect(dragHandle?.className).toContain("touch-none");
    expect(dragHandle?.className).not.toContain("opacity-0");
    await act(async () => {
      dragHandle?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    });
    expect(requestDrag).toHaveBeenCalledTimes(1);
    const petSwitch = container.querySelector<HTMLButtonElement>(
      '[aria-label="Switch to Misty pet"]',
    );
    expect(petSwitch).not.toBeNull();
    await act(async () => petSwitch?.click());
    expect(switchToPet).toHaveBeenCalledTimes(1);
    await act(async () => {
      input?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    });
    expect(requestDrag).toHaveBeenCalledTimes(1);

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(input, "a ");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 220));
    });

    expect(container.querySelector("[data-global-misty-launcher-input]")).toBe(input);
    expect(input?.value).toBe("a ");
    expect(document.activeElement).toBe(input);
    expect(container.textContent).not.toContain("Ask Misty “a”");
    expect(container.querySelector('[aria-label="Misty candidates"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Search filters"]')).not.toBeNull();
    expect(contentVisibilityChanged).toHaveBeenLastCalledWith(true);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-misty-mode="ask"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const askInput = container.querySelector<HTMLTextAreaElement>(
      "[data-global-misty-launcher-input]",
    );
    expect(askInput?.value).toBe("a ");
    expect(askInput?.placeholder).toBe("Ask a follow-up…");
    expect(useGlobalSearchStore.getState().mode).toBe("ask");
    expect(useGlobalSearchStore.getState().panel).toBe("answer");
    expect(container.querySelector("[data-misty-conversation-scroll]")).not.toBeNull();
    expect(container.querySelector("[data-misty-voice-island]")).not.toBeNull();
    expect(
      container
        .querySelector<HTMLButtonElement>('[data-misty-mode="ask"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");

    const islandDragHandle = container.querySelector<HTMLButtonElement>(
      '[data-misty-voice-island] [aria-label="Move Misty window"]',
    );
    expect(islandDragHandle).not.toBeNull();
    await act(async () => {
      islandDragHandle?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    });
    expect(requestDrag).toHaveBeenCalledTimes(2);
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Switch to Misty pet"]')?.click();
    });
    expect(switchToPet).toHaveBeenCalledTimes(2);

    await act(async () => {
      container.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    // Floating panel stays open on outside click
    expect(useGlobalSearchStore.getState().panel).toBe("answer");

    container.tabIndex = 0;
    container.focus();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(useGlobalSearchStore.getState().panel).toBe("closed");
  });

  it("keeps Ask history scrollable while a follow-up is composed", async () => {
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

    await act(async () => {
      useGlobalSearchStore.setState({
        panel: "answer",
        mode: "ask",
        activeConversationId: "conversation-1",
        conversations: [
          {
            id: "conversation-1",
            title: "Arcadia weather",
            createdAt: "2026-08-25T18:00:00.000Z",
            updatedAt: "2026-08-25T18:01:00.000Z",
            remote: false,
            messages: [
              {
                id: "user-1",
                role: "user",
                mode: "ask",
                content: "How hot will it be in Arcadia today?",
                createdAt: "2026-08-25T18:00:00.000Z",
              },
              {
                id: "assistant-1",
                role: "assistant",
                mode: "ask",
                content: "Arcadia will be warm this afternoon.",
                createdAt: "2026-08-25T18:01:00.000Z",
              },
            ],
          },
        ],
      });
    });

    expect(container.querySelector('[data-misty-conversation="true"]')).not.toBeNull();
    expect(container.querySelector("[data-misty-conversation-scroll]")).not.toBeNull();
    expect(container.querySelector('[data-misty-composer="follow-up"]')).not.toBeNull();
    expect(container.textContent).toContain("Arcadia will be warm this afternoon.");

    const panel = container.querySelector<HTMLElement>("[data-html2canvas-ignore]");
    vi.spyOn(panel!, "getBoundingClientRect").mockReturnValue({
      x: 100,
      y: 50,
      top: 50,
      right: 900,
      bottom: 700,
      left: 100,
      width: 800,
      height: 650,
      toJSON: () => ({}),
    });
    const dragHandle = container.querySelector<HTMLButtonElement>(
      '[data-misty-voice-island] [aria-label="Move Misty window"]',
    );
    expect(dragHandle).not.toBeNull();
    await act(async () => {
      dragHandle?.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: 500,
          clientY: 100,
        }),
      );
      window.dispatchEvent(
        new MouseEvent("pointermove", {
          bubbles: true,
          clientX: 548,
          clientY: 132,
        }),
      );
    });
    expect(panel?.style.translate).toBe("48px 32px");

    const input = container.querySelector<HTMLTextAreaElement>(
      "[data-global-misty-launcher-input]",
    );
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(input, "What about tonight?");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(input?.placeholder).toBe("Ask a follow-up…");
    expect(useGlobalSearchStore.getState().panel).toBe("answer");
    expect(container.querySelector("[data-misty-conversation-scroll]")).not.toBeNull();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-misty-mode="search"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(useGlobalSearchStore.getState().panel).toBe("results");
  });
});
