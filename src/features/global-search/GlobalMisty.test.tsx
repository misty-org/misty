import { useAiSurfaceStore } from "@/features/ai-surface/store";
import { initializeHostAgentsRuntime } from "@/features/agents/hostAgentsRuntime";
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

import * as localExecution from "@/features/agents/localExecution";
import { GlobalMisty } from "./GlobalMisty";
import { useGlobalSearchStore } from "./useGlobalSearchStore";

initializeHostAgentsRuntime();

describe("GlobalMisty", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    localExecution.useLocalExecution.setState({ execution: null });
    useAiSurfaceStore.setState({ registrations: {} });
    useGlobalSearchStore.getState().setAccount("");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    localExecution.useLocalExecution.setState({ execution: null });
    vi.restoreAllMocks();
  });

  it.each(["context", "selection"])(
    "keeps Search usable when app %s access is denied",
    async (denied) => {
      const reject = () => {
        throw new Error("This App does not have ai.use permission.");
      };
      useAiSurfaceStore.setState({
        registrations: {
          "account-1:files-pane": {
            accountId: "account-1",
            paneId: "files-pane",
            element: document.createElement("div"),
            adapter: {
              surfaceId: "files",
              label: "Files",
              getContext: denied === "context" ? reject : () => [],
              getSelection: denied === "selection" ? reject : () => null,
            },
          },
        },
      });
      await act(async () => {
        root.render(
          <MemoryRouter>
            <GlobalMisty
              accountId="account-1"
              currentPath="/apps/files"
              activePaneId="files-pane"
            />
          </MemoryRouter>,
        );
      });
      await act(async () => useGlobalSearchStore.getState().activateLauncher());
      expect(container.querySelector("[data-global-misty-launcher-input]")).not.toBeNull();
      useAiSurfaceStore.setState({ registrations: {} });
    },
  );

  it("keeps one stable input while search results expand beneath it", async () => {
    const contentVisibilityChanged = vi.fn();
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/browser"]}>
          <GlobalMisty
            accountId="account-1"
            currentPath="/browser"
            activePaneId=""
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
    expect(container.querySelector('[aria-label="Search or Ask"]')).toBeNull();
    expect(container.querySelector('[aria-label="Misty candidates"]')).toBeNull();
    expect(container.querySelector('[aria-label="Search filters"]')).toBeNull();
    expect(contentVisibilityChanged).toHaveBeenLastCalledWith(false);

    expect(container.querySelector("[data-misty-panel-drag-handle]")).toBeNull();

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

    expect(useGlobalSearchStore.getState().mode).toBe("search");
    expect(container.querySelector('[data-misty-mode="ask"]')).toBeNull();
  });
});
