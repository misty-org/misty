import { Globe, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { browserFaviconUrl } from "@/features/app-windows";
import {
  cn,
  IconButton,
  OverflowFadeText,
  Pressable,
  Spinner,
  Surface,
  Text,
  Tooltip,
} from "@/shared/ui";
import { addPersonTab } from "../tabs/agentPersonTabs";
import { closeAgentTab } from "../tabs/agentTabs";
import {
  showViewTab,
  useAgentBrowser,
  type AgentBrowserTab,
  type AgentBrowserView,
} from "./agentBrowserStore";
import { SiteIcon } from "@/features/browser";

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
  const icon = tab?.faviconUrl ?? (tab?.url ? browserFaviconUrl(tab.url) : null);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [icon]);
  if (tab?.loading)
    return (
      <Text bare tone={active ? "bright" : "muted"} className="flex shrink-0">
        <Spinner label={false} style={{ width: 16, height: 16 }} />
      </Text>
    );
  if (icon && !failed)
    return (
      <SiteIcon
        className="size-4 shrink-0 select-none rounded-sm object-contain"
        url={icon}
        onFailed={() => setFailed(true)}
      />
    );
  return <Globe className="shrink-0" aria-hidden="true" />;
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
      className="flex min-w-0 shrink-0 gap-1 overflow-x-auto [scrollbar-width:none]"
    >
      {view.tabs.map((scope, index) => {
        const tab = tabs[scope];
        const active = scope === view.shownScope;
        const label = agentTabLabel(tab);
        return (
          // A tab and its close button: the wrapper takes the strip's sizing and the tab's fill;
          // the button sits over the tab's right edge and shows on hover, focus and the shown tab.
          <Surface
            key={scope}
            tone={active ? "card" : "none"}
            radius="md"
            wash={active ? undefined : "card"}
            className="group/tab relative flex min-w-26 max-w-50 flex-1"
            data-active={active || undefined}
          >
            <Tooltip content={label}>
              <Pressable
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                data-scope={scope}
                className="flex h-8 min-w-0 flex-auto items-center overflow-hidden whitespace-nowrap pr-7 pl-2"
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
                <Text
                  bare
                  size="meta"
                  tone={active ? "bright" : "muted"}
                  className="flex min-w-0 flex-1 items-center gap-2"
                >
                  <AgentTabIcon tab={tab} active={active} />
                  <OverflowFadeText className="min-w-0 flex-1 whitespace-nowrap text-left">
                    {label}
                  </OverflowFadeText>
                </Text>
              </Pressable>
            </Tooltip>
            <IconButton
              label={`Close ${label}`}
              size="sm"
              className={cn(
                "absolute top-1 right-1 opacity-0",
                "group-hover/tab:opacity-100 group-focus-within/tab:opacity-100",
                "group-data-[active]/tab:opacity-100",
              )}
              onClick={() => void closeAgentTab(scope)}
            >
              <X />
            </IconButton>
          </Surface>
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
