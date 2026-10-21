import { Globe } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { browserTabRowStyles } from "@/features/browser";
import { parseBrowserViewState } from "@/features/workspace";
import { OverflowFadeText, Pressable, Spinner } from "@/shared/ui";
import { showViewTab, useAgentBrowser, type AgentBrowserTab, type AgentBrowserView } from "./agentBrowserStore";

export const agentTabLabel = (tab: AgentBrowserTab | undefined) => {
  if (!tab) return "Page";
  if (tab.title) return tab.title;
  try {
    return new URL(tab.url).hostname.replace(/^www\./, "");
  } catch {
    return "Page";
  }
};

/** A tab's site icon, a spinner while it loads, as in the window's tab sidebar. */
function AgentTabIcon({ tab, active }: { tab: AgentBrowserTab | undefined; active: boolean }) {
  const icon = tab?.faviconUrl ?? (tab?.url ? parseBrowserViewState({ url: tab.url }).faviconUrl : null);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [icon]);
  if (tab?.loading)
    return <Spinner label={false} className={active ? "text-cream-bright" : "text-cream-muted"} style={{ width: 16, height: 16 }} />;
  if (icon && !failed)
    return (
      <img
        alt=""
        className="size-4 shrink-0 select-none rounded-sm object-contain"
        decoding="async"
        draggable={false}
        src={icon}
        onError={() => setFailed(true)}
      />
    );
  return <Globe className="size-4 shrink-0" aria-hidden="true" />;
}

/**
 * The agent browser's side card, a small copy of the window's tab sidebar: back, forward and
 * reload in its head, the address field, the shown view's tabs as the sidebar's rows, and the
 * actions at its foot. Tabs never sit in a horizontal strip.
 */
export function AgentBrowserTabs({
  conversationId,
  view,
  head,
  address,
  foot,
}: {
  conversationId: string;
  view: AgentBrowserView;
  head: ReactNode;
  address: ReactNode;
  foot: ReactNode;
}) {
  const tabs = useAgentBrowser((state) => state.tabs);
  const list = useRef<HTMLDivElement>(null);
  const select = (scope: string, focus = false) => {
    showViewTab(conversationId, view.id, scope);
    if (focus)
      requestAnimationFrame(() =>
        list.current?.querySelector<HTMLButtonElement>(`[data-scope="${CSS.escape(scope)}"]`)?.focus(),
      );
  };
  return (
    <aside className="misty-sidebar-card agent-browser-sidebar" data-side-tab-list="">
      <div className="misty-sidebar-head">{head}</div>
      <div className="misty-sidebar-address">{address}</div>
      <div
        ref={list}
        role="tablist"
        aria-label={`${view.label} tabs`}
        aria-orientation="vertical"
        className="misty-workspace-tab-list flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-x-hidden overflow-y-auto"
      >
        {view.tabs.map((scope, index) => {
          const tab = tabs[scope];
          const active = scope === view.shownScope;
          const label = agentTabLabel(tab);
          return (
            <div key={scope} data-active={active} className={browserTabRowStyles.row(active)}>
              <Pressable
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                title={label}
                data-scope={scope}
                className={browserTabRowStyles.button}
                onClick={() => select(scope)}
                onKeyDown={(event) => {
                  const count = view.tabs.length;
                  const next =
                    event.key === "ArrowDown"
                      ? (index + 1) % count
                      : event.key === "ArrowUp"
                        ? (index + count - 1) % count
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? count - 1
                            : -1;
                  if (event.altKey || event.ctrlKey || event.metaKey || next < 0) return;
                  event.preventDefault();
                  select(view.tabs[next]!, true);
                }}
              >
                <AgentTabIcon tab={tab} active={active} />
                <OverflowFadeText className={browserTabRowStyles.title}>{label}</OverflowFadeText>
              </Pressable>
            </div>
          );
        })}
      </div>
      <div className="misty-sidebar-foot">{foot}</div>
    </aside>
  );
}
