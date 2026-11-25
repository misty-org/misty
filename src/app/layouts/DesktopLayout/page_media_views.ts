import { useMemo } from "react";
import { useAgentBrowser } from "@/features/agents";
import { useWorkspaceStore, workspaceTabsById, type WorkspaceView } from "@/features/app-windows";
import { pageLabel, usePageMedia, useWebTabs, type PlayingPage } from "@/features/browser";

export interface PlayingSource {
  page: PlayingPage;
  view?: WorkspaceView;
  name: string;
}

function routeParts(route: string) {
  const url = new URL(route, "https://misty.local");
  return {
    parts: url.pathname
      .split("/")
      .filter(Boolean)
      .map((part) => {
        try {
          return decodeURIComponent(part);
        } catch {
          return "";
        }
      }),
    conversation: url.searchParams.get("conversation") ?? "",
  };
}

export function usePlayingSources(): PlayingSource[] {
  const pages = usePageMedia((state) => state.pages);
  const webTabs = useWebTabs((state) => state.tabs);
  const agentTabs = useAgentBrowser((state) => state.tabs);
  const chats = useAgentBrowser((state) => state.chats);
  const layout = useWorkspaceStore((state) => state.layout);
  const asides = useWorkspaceStore((state) => state.asides);
  return useMemo(() => {
    const views = [...workspaceTabsById({ layout, asides }).values()].filter(
      (view) => !view.placeholder,
    );
    const routed = views.map((view) => ({ view, ...routeParts(view.route) }));
    const sources: PlayingSource[] = [];
    for (const page of Object.values(pages)) {
      if (page.kind === "app") {
        const found = routed.find(
          ({ parts }) =>
            parts[2] === "app" &&
            parts[3] === page.appId &&
            (!page.spaceId || parts[1] === page.spaceId),
        )?.view;
        if (found) sources.push({ page, view: found, name: found.title });
        continue;
      }
      const webTab = Object.values(webTabs).find((tab) => tab.viewId === page.id);
      if (webTab) {
        const found = routed.find(
          ({ parts }) => parts[0] === "browser" && parts[1] === webTab.id,
        )?.view;
        if (found) sources.push({ page, view: found, name: pageLabel(webTab.url, webTab.title) });
        continue;
      }
      const scope = Object.entries(agentTabs).find(([, tab]) => tab.viewId === page.id)?.[0];
      if (!scope) continue;
      const tab = agentTabs[scope]!;
      const conversation = Object.values(chats).find((chat) =>
        chat.views.some((view) => view.tabs.includes(scope)),
      )?.conversationId;
      const found = conversation
        ? routed.find(
            ({ view, conversation: open }) => view.surfaceId === "agents" && open === conversation,
          )?.view
        : undefined;
      sources.push({ page, view: found, name: pageLabel(tab.url, tab.title) });
    }
    return sources;
  }, [pages, webTabs, agentTabs, chats, layout, asides]);
}
