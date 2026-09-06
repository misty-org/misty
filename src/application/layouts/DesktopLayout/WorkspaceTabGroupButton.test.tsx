import type { WorkspaceTab } from "@/features/workspace";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Code2, Inbox } from "lucide-react";
import {
  workspaceTabDropIndex,
  WorkspaceTabGroupButton,
  type TabGroup,
} from "./WorkspaceTabGroupButton";

it("computes grouped drop positions in pane order and adjusts for same-pane removal", () => {
  const paneTabs = ["one", "two", "three", "four"].map((id) => ({ id }) as WorkspaceTab);
  expect(workspaceTabDropIndex(paneTabs, "one", "four")).toBe(2);
  expect(workspaceTabDropIndex(paneTabs, "four", "two")).toBe(1);
  expect(workspaceTabDropIndex(paneTabs, "external", "three")).toBe(2);
});

describe("WorkspaceTabGroupButton", () => {
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

  it("uses the active filename for a Code group", () => {
    const code: WorkspaceTab = {
      id: "code-a",
      surfaceId: "code",
      groupKey: "tool:code",
      instanceKey: "code-a",
      title: "scheduler.tsx",
      route: "/code",
      sidebarVisible: true,
      state: {},
      createdAt: 1,
      lastFocusedAt: 1,
    };
    const group: TabGroup = {
      key: code.groupKey,
      surfaceId: code.surfaceId,
      label: "Code",
      tabs: [code],
      storeGroupKey: code.groupKey,
    };

    act(() => {
      root.render(
        <WorkspaceTabGroupButton
          group={group}
          icon={Code2}
          activeTabId={code.id}
          canClose
          lastUsedTabByGroup={{}}
          onOpen={vi.fn()}
          onClose={vi.fn()}
          onMoveTab={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("scheduler.tsx");
  });

  it("uses one responsive width contract for every top-level tab", () => {
    const tab: WorkspaceTab = {
      id: "tab:inbox",
      surfaceId: "inbox",
      groupKey: "tool:inbox",
      instanceKey: "inbox",
      title: "Inbox",
      route: "/inbox",
      sidebarVisible: true,
      state: {},
      createdAt: 1,
      lastFocusedAt: 1,
    };
    const group: TabGroup = {
      key: tab.groupKey,
      surfaceId: tab.surfaceId,
      label: "Inbox",
      tabs: [tab],
      storeGroupKey: tab.groupKey,
    };

    act(() => {
      root.render(
        <WorkspaceTabGroupButton
          group={group}
          icon={Inbox}
          activeTabId={tab.id}
          canClose
          lastUsedTabByGroup={{}}
          onOpen={vi.fn()}
          onClose={vi.fn()}
          onMoveTab={vi.fn()}
        />,
      );
    });

    const renderedTab = container.firstElementChild;
    expect(renderedTab?.className).toContain("flex-[1_1_120px]");
    expect(renderedTab?.className).toContain("min-w-[36px]");
    expect(renderedTab?.className).toContain("max-w-[160px]");
  });

  it("centers a grouped tab count in a fixed badge box", () => {
    const tabs = ["one", "two"].map(
      (id) =>
        ({
          id,
          surfaceId: "inbox",
          groupKey: "tool:inbox",
          instanceKey: id,
          title: `Inbox ${id}`,
          route: "/inbox",
          sidebarVisible: true,
          state: {},
          createdAt: 1,
          lastFocusedAt: 1,
        }) satisfies WorkspaceTab,
    );

    act(() => {
      root.render(
        <WorkspaceTabGroupButton
          group={{
            key: "tool:inbox",
            surfaceId: "inbox",
            label: "Inbox",
            tabs,
            storeGroupKey: "tool:inbox",
          }}
          icon={Inbox}
          activeTabId={tabs[0].id}
          canClose
          lastUsedTabByGroup={{}}
          onOpen={vi.fn()}
          onClose={vi.fn()}
          onMoveTab={vi.fn()}
        />,
      );
    });

    const badge = [...container.querySelectorAll("span")].find(
      (element) => element.textContent === "2",
    );
    expect(badge?.className).toContain("items-center");
    expect(badge?.className).toContain("justify-center");
    expect(badge?.className).toContain("leading-none");
    expect(badge?.className).toContain("tabular-nums");
  });

  it("does not offer a close control for the final tab in the final window", () => {
    const tab: WorkspaceTab = {
      id: "tab:inbox",
      surfaceId: "inbox",
      groupKey: "tool:inbox",
      instanceKey: "inbox",
      title: "Inbox",
      route: "/inbox",
      sidebarVisible: false,
      state: {},
      createdAt: 1,
      lastFocusedAt: 1,
    };

    act(() => {
      root.render(
        <WorkspaceTabGroupButton
          group={{
            key: tab.groupKey,
            surfaceId: tab.surfaceId,
            label: "Inbox",
            tabs: [tab],
            storeGroupKey: tab.groupKey,
          }}
          icon={Inbox}
          activeTabId={tab.id}
          canClose={false}
          lastUsedTabByGroup={{}}
          onOpen={vi.fn()}
          onClose={vi.fn()}
          onMoveTab={vi.fn()}
        />,
      );
    });

    expect(container.querySelector('[aria-label="Close Inbox"]')).toBeNull();
  });

  it("renders a close icon for Home when closing is allowed", () => {
    const home: WorkspaceTab = {
      id: "tab:home",
      surfaceId: "space",
      groupKey: "space:family",
      instanceKey: "family",
      title: "Home",
      route: "/spaces/family/home",
      sidebarVisible: false,
      state: {},
      createdAt: 1,
      lastFocusedAt: 1,
    };

    act(() => {
      root.render(
        <WorkspaceTabGroupButton
          group={{
            key: home.groupKey,
            surfaceId: home.surfaceId,
            label: "Home",
            tabs: [home],
            storeGroupKey: home.groupKey,
          }}
          icon={Inbox}
          activeTabId={home.id}
          canClose
          canCloseTab={() => true}
          lastUsedTabByGroup={{}}
          onOpen={vi.fn()}
          onClose={vi.fn()}
          onMoveTab={vi.fn()}
        />,
      );
    });

    expect(container.querySelector('[aria-label="Close Home"]')).not.toBeNull();
  });

  it("uses a fallback icon when persisted surface metadata is missing", () => {
    const tab: WorkspaceTab = {
      id: "tab:retired",
      surfaceId: "inbox",
      groupKey: "tool:inbox",
      instanceKey: "retired",
      title: "Retired tool",
      route: "/retired",
      sidebarVisible: false,
      state: {},
      createdAt: 1,
      lastFocusedAt: 1,
    };

    expect(() => {
      act(() => {
        root.render(
          <WorkspaceTabGroupButton
            group={{
              key: "tool:retired",
              surfaceId: tab.surfaceId,
              label: tab.title,
              tabs: [tab],
              storeGroupKey: null,
            }}
            icon={undefined}
            activeTabId={tab.id}
            canClose={false}
            lastUsedTabByGroup={{}}
            onOpen={vi.fn()}
            onClose={vi.fn()}
            onMoveTab={vi.fn()}
          />,
        );
      });
    }).not.toThrow();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders only the favicon without the default icon when faviconUrl exists", async () => {
    const browserTab: WorkspaceTab = {
      id: "tab:browser-1",
      surfaceId: "browser",
      groupKey: "tool:browser",
      instanceKey: "browser-1",
      title: "LeetCode",
      route: "/browser",
      sidebarVisible: false,
      state: { url: "https://leetcode.com", faviconUrl: "https://leetcode.com/favicon.ico" },
      createdAt: 1,
      lastFocusedAt: 1,
    };

    act(() => {
      root.render(
        <WorkspaceTabGroupButton
          group={{
            key: browserTab.groupKey,
            surfaceId: browserTab.surfaceId,
            label: "Browser",
            tabs: [browserTab],
            storeGroupKey: null,
          }}
          icon={Inbox}
          activeTabId={browserTab.id}
          canClose={false}
          lastUsedTabByGroup={{}}
          onOpen={vi.fn()}
          onClose={vi.fn()}
          onMoveTab={vi.fn()}
        />,
      );
    });

    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.src).toBe("https://leetcode.com/favicon.ico");
    // Default SVG icon must not be rendered behind the favicon
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders a loading spinner as the favicon when a webpage is loading", async () => {
    const { useBrowserRuntimeStore } = await import("@/features/browser");
    const browserTab: WorkspaceTab = {
      id: "tab:browser-loading",
      surfaceId: "browser",
      groupKey: "tool:browser",
      instanceKey: "browser-loading",
      title: "Loading Page",
      route: "/browser",
      sidebarVisible: false,
      state: { url: "https://example.com", faviconUrl: "https://example.com/favicon.ico" },
      createdAt: 1,
      lastFocusedAt: 1,
    };

    act(() => {
      useBrowserRuntimeStore.getState().setLoading(browserTab.id, true);
      root.render(
        <WorkspaceTabGroupButton
          group={{
            key: browserTab.groupKey,
            surfaceId: browserTab.surfaceId,
            label: "Browser",
            tabs: [browserTab],
            storeGroupKey: null,
          }}
          icon={Inbox}
          activeTabId={browserTab.id}
          canClose={false}
          lastUsedTabByGroup={{}}
          onOpen={vi.fn()}
          onClose={vi.fn()}
          onMoveTab={vi.fn()}
        />,
      );
    });

    // While loading, the image must not be rendered; instead a spinning loader svg is shown
    expect(container.querySelector("img")).toBeNull();
    const spinner = container.querySelector("svg");
    expect(spinner).not.toBeNull();
    expect(spinner?.classList.contains("animate-spin")).toBe(true);

    // When loading finishes, the favicon image appears
    act(() => {
      useBrowserRuntimeStore.getState().setLoading(browserTab.id, false);
    });
    expect(container.querySelector("img")).not.toBeNull();
  });

  it("cycles to the next tab in the group when clicking an already-active group", () => {
    const tab1: WorkspaceTab = {
      id: "tab-1",
      surfaceId: "browser",
      groupKey: "tool:browser",
      instanceKey: "tab-1",
      title: "Google",
      route: "/browser",
      sidebarVisible: true,
      state: {},
      createdAt: 1,
      lastFocusedAt: 2,
    };
    const tab2: WorkspaceTab = {
      id: "tab-2",
      surfaceId: "browser",
      groupKey: "tool:browser",
      instanceKey: "tab-2",
      title: "GitHub",
      route: "/browser",
      sidebarVisible: true,
      state: {},
      createdAt: 2,
      lastFocusedAt: 1,
    };
    const onOpen = vi.fn();

    act(() => {
      root.render(
        <WorkspaceTabGroupButton
          group={{
            key: "tool:browser",
            surfaceId: "browser",
            label: "Browser",
            tabs: [tab1, tab2],
            storeGroupKey: "tool:browser",
          }}
          icon={Inbox}
          activeTabId={tab1.id}
          canClose={true}
          lastUsedTabByGroup={{ "tool:browser": tab1.id }}
          onOpen={onOpen}
          onClose={vi.fn()}
          onMoveTab={vi.fn()}
        />,
      );
    });

    const mainButton = container.querySelector("button")!;
    act(() => {
      mainButton.click();
    });

    expect(onOpen).toHaveBeenCalledWith(tab2);
  });

  it("displays Space content first and keeps context in the tooltip", () => {
    const plannerTab: WorkspaceTab = {
      id: "tab-planner",
      surfaceId: "space",
      groupKey: "space:proj-1:planner",
      instanceKey: "proj-1:planner",
      title: "Launch plan",
      route: "/spaces/proj-1/planner",
      sidebarVisible: true,
      state: {},
      createdAt: 2,
      lastFocusedAt: 2,
    };

    act(() => {
      root.render(
        <WorkspaceTabGroupButton
          group={{
            key: "space:proj-1:planner",
            surfaceId: "space",
            label: "Planner",
            contextLabel: "Misty Space · Planner",
            tabs: [plannerTab],
            storeGroupKey: "space:proj-1:planner",
          }}
          icon={null}
          activeTabId={plannerTab.id}
          canClose={true}
          lastUsedTabByGroup={{}}
          onOpen={vi.fn()}
          onClose={vi.fn()}
          onMoveTab={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("Launch plan");
    expect(container.textContent).not.toContain("Misty Space · Planner");
    expect(container.querySelector("button")?.getAttribute("title")).toBe(
      "Launch plan • Misty Space · Planner",
    );
  });

  it("normalizes a persisted Space-prefixed generic title", () => {
    const chatTab = testTab({
      id: "tab-chat",
      surfaceId: "space",
      groupKey: "space:family:chat",
      title: "Family Chat",
      route: "/spaces/family/chat",
    });

    act(() => {
      root.render(
        <WorkspaceTabGroupButton
          group={{
            key: "space:family:chat",
            surfaceId: "space",
            label: "Chat",
            contextLabel: "Family · Chat",
            tabs: [chatTab],
            storeGroupKey: "space:family:chat",
          }}
          icon={null}
          activeTabId={chatTab.id}
          canClose
          lastUsedTabByGroup={{}}
          onOpen={vi.fn()}
          onClose={vi.fn()}
          onMoveTab={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("Chat");
    expect(container.textContent).not.toContain("Family Chat");
    expect(container.querySelector("button")?.getAttribute("title")).toBe("Chat • Family · Chat");
  });

  it("displays the active tab title directly and provides context in tooltip", () => {
    const termTab = testTab({
      id: "tab-term",
      surfaceId: "terminal",
      groupKey: "tool:terminal",
      title: "zsh",
      route: "/terminal",
    });

    act(() => {
      root.render(
        <WorkspaceTabGroupButton
          group={{
            key: "tool:terminal",
            surfaceId: "terminal",
            label: "Terminal",
            tabs: [termTab],
            storeGroupKey: "tool:terminal",
          }}
          icon={null}
          activeTabId={termTab.id}
          canClose={true}
          lastUsedTabByGroup={{}}
          onOpen={vi.fn()}
          onClose={vi.fn()}
          onMoveTab={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("zsh");
    expect(container.querySelector("button")?.getAttribute("title")).toBe("zsh • Terminal");
  });

  it("displays the group label when tab title is default", () => {
    const inboxTab = testTab({
      id: "tab-inbox",
      surfaceId: "inbox",
      groupKey: "tool:inbox",
      title: "Inbox",
      route: "/inbox",
    });

    act(() => {
      root.render(
        <WorkspaceTabGroupButton
          group={{
            key: "tool:inbox",
            surfaceId: "inbox",
            label: "Inbox",
            tabs: [inboxTab],
            storeGroupKey: "tool:inbox",
          }}
          icon={null}
          activeTabId={inboxTab.id}
          canClose={true}
          lastUsedTabByGroup={{}}
          onOpen={vi.fn()}
          onClose={vi.fn()}
          onMoveTab={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("Inbox");
    expect(container.querySelector("button")?.getAttribute("title")).toBe("Inbox");
  });

  it("switches back to the last active tab within a group when group is clicked", () => {
    const tab1 = testTab({ id: "tab-inbox-1", title: "Inbox" });
    const tab2 = testTab({ id: "tab-inbox-2", title: "Inbox 2", createdAt: 2, lastFocusedAt: 2 });
    const onOpen = vi.fn();

    act(() => {
      root.render(
        <WorkspaceTabGroupButton
          group={{
            key: "tool:inbox",
            surfaceId: "inbox",
            label: "Inbox",
            tabs: [tab1, tab2],
            storeGroupKey: "tool:inbox",
          }}
          icon={null}
          activeTabId="other-tab"
          canClose={true}
          lastUsedTabByGroup={{ "tool:inbox": tab2.id }}
          onOpen={onOpen}
          onClose={vi.fn()}
          onMoveTab={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("Inbox 2");
    expect(container.querySelector("button")?.getAttribute("title")).toBe("Inbox 2 • Inbox");

    const mainButton = container.querySelector("button")!;
    act(() => {
      mainButton.click();
    });

    expect(onOpen).toHaveBeenCalledWith(tab2);
  });
});

function testTab(partial: Partial<WorkspaceTab> & { id: string; title: string }): WorkspaceTab {
  return {
    surfaceId: "inbox",
    groupKey: "tool:inbox",
    instanceKey: partial.id,
    route: "/inbox",
    sidebarVisible: true,
    state: {},
    createdAt: 1,
    lastFocusedAt: 1,
    ...partial,
  };
}
