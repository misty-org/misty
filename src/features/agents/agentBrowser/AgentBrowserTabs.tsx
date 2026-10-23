import { Globe, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { parseBrowserViewState } from "@/features/workspace";
import { IconButton, OverflowFadeText, Pressable, Spinner } from "@/shared/ui";
import { addPersonTab } from "../agentPersonTabs";
import { closeAgentTab } from "../agentTabs";
import {
  showViewTab,
  useAgentBrowser,
  type AgentBrowserTab,
  type AgentBrowserView,
} from "./agentBrowserStore";

const agentTabLabel = (tab: AgentBrowserTab | undefined) => {
  if (!tab) return "Page";
  if (tab.title) return tab.title;
  if (!tab.url) return "New tab";
  try {
    return new URL(tab.url).hostname.replace(/^www\./, "");
  } catch {
    return "Page";
  }
};

/** A tab's site icon, a spinner while it loads, as in the window's tab sidebar. */
function AgentTabIcon({ tab, active }: { tab: AgentBrowserTab | undefined; active: boolean }) {
  const icon =
    tab?.faviconUrl ?? (tab?.url ? parseBrowserViewState({ url: tab.url }).faviconUrl : null);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [icon]);
  if (tab?.loading)
    return (
      <Spinner
        label={false}
        className={active ? "text-cream-bright" : "text-cream-muted"}
        style={{ width: 16, height: 16 }}
      />
    );
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
 * The agent browser's tab strip: the shown view's tabs side by side above its toolbar and page,
 * like the horizontal strip Misty's own browser used to have. Only this small browser has one;
 * the window's tabs stay in the sidebar.
 */
export function AgentBrowserTabs({
  conversationId,
  view,
}: {
  conversationId: string;
  view: AgentBrowserView;
}) {
  const tabs = useAgentBrowser((state) => state.tabs);
  const list = useRef<HTMLDivElement>(null);
  const select = (scope: string, focus = false) => {
    showViewTab(conversationId, view.id, scope);
    if (focus)
      requestAnimationFrame(() =>
        list.current
          ?.querySelector<HTMLButtonElement>(`[data-scope="${CSS.escape(scope)}"]`)
          ?.focus(),
      );
  };
  return (
    <div
      ref={list}
      role="tablist"
      aria-label={`${view.label} tabs`}
      aria-orientation="horizontal"
      className="agent-browser-tabs"
    >
      {view.tabs.map((scope, index) => {
        const tab = tabs[scope];
        const active = scope === view.shownScope;
        const label = agentTabLabel(tab);
        return (
          <div key={scope} className="agent-browser-tab-wrap" data-active={active || undefined}>
            <Pressable
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              title={label}
              data-scope={scope}
              className="agent-browser-tab"
              onClick={() => select(scope)}
              // A middle click closes a tab, as in Misty's own browser.
              onAuxClick={(event) => {
                if (event.button !== 1) return;
                event.preventDefault();
                void closeAgentTab(scope);
              }}
              onKeyDown={(event) => {
                const count = view.tabs.length;
                const next =
                  event.key === "ArrowRight"
                    ? (index + 1) % count
                    : event.key === "ArrowLeft"
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
              <OverflowFadeText className="min-w-0 flex-1 whitespace-nowrap text-left">
                {label}
              </OverflowFadeText>
            </Pressable>
            <IconButton
              label={`Close ${label}`}
              className="agent-browser-tab-close"
              onClick={() => void closeAgentTab(scope)}
            >
              <X />
            </IconButton>
          </div>
        );
      })}
      <IconButton
        label="New tab for the agent"
        className="agent-browser-tab-add"
        onClick={() => {
          const scope = addPersonTab(conversationId, {
            id: view.id,
            label: view.label,
            taskId: view.taskId,
          });
          if (scope) showViewTab(conversationId, view.id, scope);
        }}
      >
        <Plus />
      </IconButton>
    </div>
  );
}
