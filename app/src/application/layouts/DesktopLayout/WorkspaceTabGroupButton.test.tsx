import type { WorkspaceTab } from "@/features/workspace";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Code2, House } from "lucide-react";
import { WorkspaceTabGroupButton, type TabGroup } from "./WorkspaceTabGroupButton";

describe("WorkspaceTabGroupButton", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
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
    act(() => {
      root.render(
        <WorkspaceTabGroupButton
          group={{
            key: "tool:code",
            surfaceId: "code",
            label: "Code",
            tabs: [code],
            storeGroupKey: "tool:code",
          }}
          icon={Code2}
          activeTabId={code.id}
          canClose
          lastUsedTabByGroup={{ "tool:code": code.id }}
          onOpen={vi.fn()}
          onClose={vi.fn()}
          onMoveTab={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("scheduler.tsx");
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("uses one responsive width contract for every top-level tab", () => {
    const tab: WorkspaceTab = {
      id: "tab:home",
      surfaceId: "home",
      groupKey: "tool:home",
      instanceKey: "home",
      title: "Home",
      route: "/",
      sidebarVisible: true,
      state: {},
      createdAt: 1,
      lastFocusedAt: 1,
    };
    const group: TabGroup = {
      key: tab.groupKey,
      surfaceId: tab.surfaceId,
      label: "Home",
      tabs: [tab],
      storeGroupKey: tab.groupKey,
    };

    act(() => {
      root.render(
        <WorkspaceTabGroupButton
          group={group}
          icon={House}
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
    expect(renderedTab?.className).toContain("flex-1");
    expect(renderedTab?.className).toContain("min-w-[36px]");
    expect(renderedTab?.className).toContain("max-w-[200px]");
  });

  it("does not offer a close control for the final tab in the final window", () => {
    const tab: WorkspaceTab = {
      id: "tab:home",
      surfaceId: "home",
      groupKey: "tool:home",
      instanceKey: "home",
      title: "Home",
      route: "/home",
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
            label: "Home",
            tabs: [tab],
            storeGroupKey: tab.groupKey,
          }}
          icon={House}
          activeTabId={tab.id}
          canClose={false}
          lastUsedTabByGroup={{}}
          onOpen={vi.fn()}
          onClose={vi.fn()}
          onMoveTab={vi.fn()}
        />,
      );
    });

    expect(container.querySelector('[aria-label="Close Home"]')).toBeNull();
  });
});
