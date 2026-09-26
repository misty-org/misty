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
import { useMistyStore } from "@/features/misty/useMistyStore";
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
              activePanePath="/apps/files"
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
        <MemoryRouter initialEntries={["/home"]}>
          <GlobalMisty
            accountId="account-1"
            currentPath="/home"
            activePaneId=""
            activePanePath=""
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

  it("keeps Ask history scrollable while a follow-up is composed", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/home"]}>
          <GlobalMisty
            controller="misty"
            accountId="account-1"
            currentPath="/home"
            activePaneId=""
            activePanePath=""
          />
        </MemoryRouter>,
      );
    });

    await act(async () => {
      useMistyStore.setState({
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

    expect(container.querySelector("[data-misty-top-controls]")).not.toBeNull();
    expect(container.querySelector('[aria-label="Move Misty window"]')).toBeNull();
    expect(
      container
        .querySelector("[data-misty-top-controls]")
        ?.contains(container.querySelector("[data-global-misty-launcher-input]")),
    ).toBe(true);

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
    expect(useMistyStore.getState().panel).toBe("answer");
    expect(container.querySelector("[data-misty-conversation-scroll]")).not.toBeNull();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-misty-mode="search"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(useMistyStore.getState().panel).toBe("answer");
  });
  it("keeps both control bars available when task chat closes and accepts messages while working", async () => {
    const followup = vi
      .spyOn(localExecution, "routeLocalFollowup")
      .mockResolvedValue("Message received.");
    await act(async () => {
      useMistyStore.setState({
        accountId: "account-1",
        panel: "closed",
        working: true,
        query: "",
        conversations: [],
      });
      localExecution.useLocalExecution.setState({
        execution: {
          accountId: "account-1",
          spaceId: "space-1",
          agentId: "agent-1",
          taskId: "task-1",
          mode: "agent",
          state: "running",
          autopilot: true,
          ready: false,
          views: [],
          context: [],
          deviceContexts: [],
        },
      });
      root.render(
        <MemoryRouter>
          <GlobalMisty
            accountId="account-1"
            currentPath="/home"
            activePaneId=""
            activePanePath=""
          />
        </MemoryRouter>,
      );
    });
    expect(container.querySelector("[data-misty-top-controls]")).not.toBeNull();
    expect(container.querySelector('[aria-label="Agent control"]')).not.toBeNull();
    await act(async () => useMistyStore.getState().setQuery("Please check the saved result"));
    const send = container.querySelector<HTMLButtonElement>('[aria-label="Send to Misty"]');
    expect(send?.disabled).toBe(false);
    await act(async () => send?.click());
    expect(followup).toHaveBeenCalledWith("Please check the saved result");
    expect(container.textContent).toContain("Message received.");
    expect(container.querySelector('[aria-label="Agent control"]')).not.toBeNull();
  });
  it("closes Search when the agent overlay opens with a dedicated voice control", async () => {
    await act(async () => {
      useMistyStore.setState({
        panel: "closed",
        working: false,
        executionMode: "agent",
        selectedAgentId: "",
        executionModeByAgent: {},
      });
      root.render(
        <MemoryRouter>
          <GlobalMisty
            accountId="account-1"
            currentPath="/home"
            activePaneId=""
            activePanePath=""
          />
        </MemoryRouter>,
      );
    });
    await act(async () => useGlobalSearchStore.getState().openPanel());
    expect(useGlobalSearchStore.getState().panel).toBe("results");
    await act(async () => useMistyStore.getState().openPanel());
    expect(useGlobalSearchStore.getState().panel).toBe("closed");
    expect(container.querySelector('[aria-label="Talk to Misty"]')).not.toBeNull();
    expect(
      container.querySelector('[data-misty-top-controls] header button[title="Switch agent"]'),
    ).not.toBeNull();
    await act(async () => useGlobalSearchStore.getState().activateLauncher());
    expect(useGlobalSearchStore.getState().panel).toBe("closed");
  });
  it("keeps pending approval details in the upper surface even when the conversation is closed", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
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
      useMistyStore.setState({
        panel: "closed",
        working: false,
        activeConversationId: "approval-conversation",
        conversations: [
          {
            id: "approval-conversation",
            title: "Review change",
            createdAt: "2026-09-22",
            updatedAt: "2026-09-22",
            remote: false,
            messages: [
              {
                id: "approval-message",
                role: "assistant",
                mode: "ask",
                content: "",
                createdAt: "2026-09-22",
                action: {
                  id: "proposal-1",
                  prompt: "Create a note",
                  risk: "write",
                  title: "Create the note",
                  summary: "Save a note in this Space.",
                  state: "awaiting_approval",
                  approvalId: "approval-1",
                  requiresConfirmation: true,
                },
              },
            ],
          },
        ],
      });
    });
    const review = container.querySelector('[aria-label="Pending agent approval"]');
    expect(review?.textContent).toContain("Create the note");
    expect(container.querySelector("[data-misty-top-controls]")?.contains(review)).toBe(true);
    expect(container.querySelector('[aria-label="Agent control"]')?.contains(review)).not.toBe(
      true,
    );
  });
});
