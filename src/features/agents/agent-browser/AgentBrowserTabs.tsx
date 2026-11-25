import { Globe, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  cn,
  IconButton,
  OverflowFadeText,
  Pressable,
  Spinner,
  Surface,
  Text,
  Tooltip,
} from "@misty/ui";
import { addPersonTab } from "../tabs/agent_person_tabs";
import { closeAgentTab } from "../tabs/agent_tabs";
import {
  showViewTab,
  useAgentBrowser,
  type AgentBrowserTab,
  type AgentBrowserView,
} from "./agent_browser_store";
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

function AgentTabIcon({ tab, active }: { tab: AgentBrowserTab | undefined; active: boolean }) {
  const page = tab?.url && /^https?:\/\//i.test(tab.url) ? tab.url : null;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [page, tab?.faviconUrl]);
  if (tab?.loading)
    return (
      <Text bare tone={active ? "bright" : "muted"} className="flex shrink-0">
        <Spinner
          label={false}
          style={{ width: "calc(var(--spacing) * 4)", height: "calc(var(--spacing) * 4)" }}
        />
      </Text>
    );
  if (page && !failed)
    return (
      <SiteIcon
        className="size-4 shrink-0 select-none rounded-sm object-contain"
        url={page}
        icon={tab?.faviconUrl}
        onFailed={() => setFailed(true)}
      />
    );
  return <Globe className="shrink-0" aria-hidden="true" />;
}

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
