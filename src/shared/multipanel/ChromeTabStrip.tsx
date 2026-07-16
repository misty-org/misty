import { Tabs } from "@sinm/react-chrome-tabs";
import type { TabProperties } from "@sinm/react-chrome-tabs/dist/chrome-tabs";
import { Plus } from "lucide-react";
import "@sinm/react-chrome-tabs/css/chrome-tabs.css";
import "@sinm/react-chrome-tabs/css/chrome-tabs-dark-theme.css";
import "./chromeTabs.css";
import { memo, useEffect, useMemo, useRef, type ReactNode } from "react";

export interface ChromeTabStripTab {
  id: string;
  title: string;
}

interface ChromeTabStripProps {
  tabs: ChromeTabStripTab[];
  activeTabId: string;
  actions?: ReactNode;
  canCloseTab?: (tab: ChromeTabStripTab) => boolean;
  onAddTab: () => void;
  onCloseTab: (tab: ChromeTabStripTab) => void;
  onReorderTab?: (tabId: string, fromIndex: number, toIndex: number) => void;
  onSelectTab: (tabId: string) => void;
}

const chromeTabShellClass = [
  "misty-chrome-tabs-shell",
  "flex h-[46px] min-w-0 overflow-hidden",
  "!bg-transparent",
  "[&_.chrome-tab_.chrome-tab-background>svg_.chrome-tab-geometry]:!fill-[var(--misty-app-tab-bg,var(--misty-bg-soft))]",
  "[&_.chrome-tab[active]_.chrome-tab-background>svg_.chrome-tab-geometry]:!fill-[var(--misty-app-tab-active-bg,var(--misty-surface-2))]",
].join(" ");

const chromeTabTrayClass = [
  "misty-chrome-tabs-tray",
  "flex h-8 flex-none items-center justify-end gap-0.5 rounded-[11px] p-0.5",
].join(" ");

export const ChromeTabStrip = memo(function ChromeTabStrip(props: ChromeTabStripProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const packageTabs = useMemo<TabProperties[]>(
    () => props.tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      active: tab.id === props.activeTabId,
      isCloseIconVisible: props.canCloseTab ? props.canCloseTab(tab) : true,
    })),
    [props.activeTabId, props.canCloseTab, props.tabs],
  );
  const tabById = useMemo(() => new Map(props.tabs.map((tab) => [tab.id, tab])), [props.tabs]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const preventNativeTabScroll = (event: WheelEvent) => {
      const target = event.target as Element | null;
      if (target?.closest(".chrome-tabs-content")) {
        event.preventDefault();
      }
    };
    shell.addEventListener("wheel", preventNativeTabScroll, { capture: true, passive: false });
    return () => shell.removeEventListener("wheel", preventNativeTabScroll, { capture: true });
  }, []);

  return (
    <div ref={shellRef} className={chromeTabShellClass}>
      <Tabs
        tabs={packageTabs}
        className="misty-chrome-tabs"
        darkMode
        draggable
        pinnedRight={(
          <div className="misty-chrome-tabs-toolbar">
            <button type="button" className="misty-chrome-tabs-add" title="New tab" onClick={props.onAddTab}>
              <Plus size={17} strokeWidth={2.4} />
            </button>
          </div>
        )}
        onTabActive={props.onSelectTab}
        onTabClose={(tabId) => {
          const tab = tabById.get(tabId);
          if (tab) props.onCloseTab(tab);
        }}
        onTabReorder={props.onReorderTab}
      />
      {props.actions ? <div className={chromeTabTrayClass}>{props.actions}</div> : null}
    </div>
  );
});
