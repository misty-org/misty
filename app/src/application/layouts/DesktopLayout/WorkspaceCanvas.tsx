import { closeBrowserRuntime } from "@/features/browser";
import { killTerminalTab } from "@/features/terminal";
import {
  useWorkspaceStore,
  workspaceMaxPanes,
  workspaceTabMatchesRoute,
  type WorkspaceGroupKey,
  type WorkspaceSurfaceId,
  type WorkspaceTab,
} from "@/features/workspace";
import { cn } from "@/shared/ui";
import {
  Blocks,
  Bot,
  Code2,
  FolderOpen,
  Globe2,
  Maximize2,
  PanelRightOpen,
  PanelTopOpen,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { EmptyWorkspacePane, WorkspaceSurface } from "./WorkspaceSurface";
import { WorkspaceNewTabMenu, type NewTabOption } from "./WorkspaceNewTabMenu";
import { WorkspaceTabGroupButton, type TabGroup } from "./WorkspaceTabGroupButton";

const surfaceIcons: Record<WorkspaceSurfaceId, LucideIcon> = {
  space: Blocks,
  browser: Globe2,
  terminal: SquareTerminal,
  code: Code2,
  files: FolderOpen,
  agents: Bot,
  extensions: Blocks,
};

const surfaceLabels: Record<WorkspaceSurfaceId, string> = {
  space: "Space",
  browser: "Browser",
  terminal: "Terminal",
  code: "Code",
  files: "Files",
  agents: "Agents",
  extensions: "Extensions",
};

const SPACES_GROUP_KEY = "collapsed:spaces";

function groupTabs(tabs: WorkspaceTab[]): TabGroup[] {
  const map = new Map<string, TabGroup>();
  for (const tab of tabs) {
    if (tab.surfaceId === "space") {
      const existing = map.get(SPACES_GROUP_KEY);
      if (existing) {
        existing.tabs.push(tab);
      } else {
        map.set(SPACES_GROUP_KEY, {
          key: SPACES_GROUP_KEY,
          surfaceId: "space",
          label: "Spaces",
          tabs: [tab],
          storeGroupKey: null,
        });
      }
      continue;
    }
    const existing = map.get(tab.groupKey);
    if (existing) {
      existing.tabs.push(tab);
    } else {
      map.set(tab.groupKey, {
        key: tab.groupKey,
        surfaceId: tab.surfaceId,
        label: surfaceLabels[tab.surfaceId],
        tabs: [tab],
        storeGroupKey: tab.groupKey,
      });
    }
  }
  return [...map.values()];
}

export function WorkspaceCanvas(props: { outlet: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const layout = useWorkspaceStore((state) => state.layout);
  const lastUsedTabByGroup = useWorkspaceStore((state) => state.lastUsedTabByGroup);
  const focusTab = useWorkspaceStore((state) => state.focusTab);
  const closeTab = useWorkspaceStore((state) => state.closeTab);
  const openBrowserTab = useWorkspaceStore((state) => state.openBrowserTab);
  const openSurface = useWorkspaceStore((state) => state.openSurface);
  const splitPane = useWorkspaceStore((state) => state.splitPane);
  const moveTab = useWorkspaceStore((state) => state.moveTab);
  const toggleMaximize = useWorkspaceStore((state) => state.toggleMaximize);
  const visiblePanes = useMemo(
    () =>
      layout.maximizedPaneId
        ? layout.panes.filter((pane) => pane.id === layout.maximizedPaneId)
        : layout.panes,
    [layout.maximizedPaneId, layout.panes],
  );
  const persistentCodeTabId = useMemo(
    () =>
      layout.panes.flatMap((pane) => pane.tabs).find((tab) => tab.surfaceId === "code")?.id ?? null,
    [layout.panes],
  );

  const openTab = (tab: WorkspaceTab) => {
    focusTab(tab.id);
    if (`${location.pathname}${location.search}` !== tab.route) navigate(tab.route);
  };

  const closeWorkspaceTab = (tab: WorkspaceTab) => {
    if (tab.surfaceId === "browser") void closeBrowserRuntime(tab);
    if (tab.surfaceId === "terminal") killTerminalTab(tab.id);
    closeTab(tab.id);
  };

  const openNewTab = (option: NewTabOption, paneId: string) => {
    if (option.surfaceId === "browser") {
      const tab = openBrowserTab({ paneId });
      openTab(tab);
      return;
    }
    const tab = openSurface({
      surfaceId: option.surfaceId,
      groupKey: `tool:${option.surfaceId}` as WorkspaceGroupKey,
      title: option.label,
      route: option.route,
      instancePolicy: option.instancePolicy ?? "multiple",
      forceNew: option.instancePolicy !== "single",
      paneId,
    });
    openTab(tab);
  };

  // Intercept ⌘W / Ctrl+W so it closes the active workspace tab instead of
  // closing the whole app window. Even without an active tab we swallow the
  // event so a stray keystroke can't quit the app.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== "w") return;
      event.preventDefault();
      event.stopPropagation();
      const state = useWorkspaceStore.getState();
      const focusedPane = state.layout.panes.find((pane) => pane.id === state.layout.focusedPaneId);
      const activeTab = focusedPane?.tabs.find((tab) => tab.id === focusedPane.activeTabId);
      if (activeTab) closeWorkspaceTab(activeTab);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={cn(
        "grid h-full min-h-0 overflow-hidden bg-charcoal-border",
        canvasGridClass(layout.preset, visiblePanes.length),
      )}
      data-workspace-panes={visiblePanes.length}
    >
      {visiblePanes.map((pane) => {
        const activeTab = pane.tabs.find((tab) => tab.id === pane.activeTabId) ?? pane.tabs[0];
        const codeTab = pane.tabs.find((tab) => tab.id === persistentCodeTabId);
        const focused = pane.id === layout.focusedPaneId;
        const groups = groupTabs(pane.tabs);
        return (
          <section
            key={pane.id}
            className="grid min-h-0 min-w-0 grid-rows-[38px_minmax(0,1fr)] overflow-hidden bg-charcoal-bg"
            data-workspace-pane={pane.id}
            onPointerDown={() => {
              if (!activeTab) return;
              if (!focused) {
                openTab(activeTab);
                return;
              }
              focusTab(activeTab.id);
            }}
          >
            <header
              className={cn(
                "flex min-w-0 items-end border-b border-charcoal-border bg-charcoal-workspace px-1.5 pt-1",
                focused && "shadow-[inset_0_-1px_0_rgba(201,225,166,0.24)]",
              )}
              onDoubleClick={() => toggleMaximize(pane.id)}
            >
              <div className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {groups.map((group) => (
                  <WorkspaceTabGroupButton
                    key={group.key}
                    group={group}
                    icon={surfaceIcons[group.surfaceId]}
                    activeTabId={activeTab?.id ?? null}
                    lastUsedTabByGroup={lastUsedTabByGroup}
                    onOpen={openTab}
                    onClose={closeWorkspaceTab}
                    onMoveTab={(tabId, index) => moveTab(tabId, pane.id, index)}
                  />
                ))}
              </div>
              <div className="ml-1 flex h-8 shrink-0 items-center gap-0.5">
                <WorkspaceNewTabMenu paneId={pane.id} onOpenNewTab={openNewTab} />
                {layout.panes.length < workspaceMaxPanes ? (
                  <>
                    <button
                      type="button"
                      className="grid size-7 place-items-center rounded text-cream-muted hover:bg-charcoal-card hover:text-cream"
                      aria-label="Split pane right"
                      title="Split right"
                      onClick={() => splitPane(pane.id, "right")}
                    >
                      <PanelRightOpen size={14} />
                    </button>
                    <button
                      type="button"
                      className="grid size-7 place-items-center rounded text-cream-muted hover:bg-charcoal-card hover:text-cream"
                      aria-label="Split pane down"
                      title="Split down"
                      onClick={() => splitPane(pane.id, "down")}
                    >
                      <PanelTopOpen size={14} />
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className="grid size-7 place-items-center rounded text-cream-muted hover:bg-charcoal-card hover:text-cream"
                  aria-label={layout.maximizedPaneId ? "Restore panes" : "Maximize pane"}
                  title={layout.maximizedPaneId ? "Restore panes" : "Maximize pane"}
                  onClick={() => toggleMaximize(pane.id)}
                >
                  <Maximize2 size={13} />
                </button>
              </div>
            </header>
            <div
              className="min-h-0 min-w-0 overflow-hidden"
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes("application/x-misty-workspace-tab")) {
                  event.preventDefault();
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                const tabId = event.dataTransfer.getData("application/x-misty-workspace-tab");
                if (tabId) moveTab(tabId, pane.id);
              }}
            >
              {codeTab ? (
                <div
                  className={cn(
                    "h-full min-h-0 w-full",
                    activeTab?.id === codeTab.id ? "block" : "hidden",
                  )}
                >
                  <WorkspaceSurface tab={codeTab} />
                </div>
              ) : null}
              {activeTab?.id === codeTab?.id ? null : activeTab ? (
                activeTab.surfaceId === "browser" ? (
                  <WorkspaceSurface tab={activeTab} />
                ) : focused &&
                  (sameRoute(activeTab.route, location.pathname, location.search) ||
                    workspaceTabMatchesRoute(activeTab, location.pathname)) ? (
                  props.outlet
                ) : (
                  <WorkspaceSurface tab={activeTab} />
                )
              ) : (
                <EmptyWorkspacePane onOpen={openQuickOpen} />
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function sameRoute(route: string, pathname: string, search: string): boolean {
  return route === `${pathname}${search}` || route === pathname;
}

function canvasGridClass(preset: string, count: number): string {
  if (count <= 1) return "grid-cols-1 grid-rows-1";
  if (preset === "rows") return "grid-cols-1 grid-rows-2";
  if (preset === "grid") return "grid-cols-2 grid-rows-2";
  return "grid-cols-2 grid-rows-1";
}

function openQuickOpen() {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
}
