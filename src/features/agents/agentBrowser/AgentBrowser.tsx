import { Hand, PictureInPicture2, Play } from "lucide-react";
import { aiSurfaceApi } from "@/features/ai-surface/api";
import { useWorkspaceStore } from "@/features/workspace";
import { Button, IconButton } from "@/shared/ui";
import "./agentBrowser.css";
import { AgentBrowserStage } from "./AgentBrowserStage";
import { AgentViewSwitcher } from "./AgentViewSwitcher";
import { agentTab } from "../agentTabs";
import { setBrowserExpanded, showViewTab, useAgentBrowser, type AgentBrowserTab } from "./agentBrowserStore";
import { useState } from "react";

const tabLabel = (tab: AgentBrowserTab | undefined) => {
  if (!tab) return "Page";
  if (tab.title) return tab.title;
  try {
    return new URL(tab.url).hostname.replace(/^www\./, "");
  } catch {
    return "Page";
  }
};

/**
 * The agent browser in the full split (docs/design/agent-browser/BRIEF.md): beside the open chat,
 * its views' switcher, the shown view's own tabs, and the page. The person reads and scrolls;
 * while the agent acts, its page takes no input until they take over.
 */
export function AgentBrowser({ conversationId }: { conversationId?: string }) {
  const chat = useAgentBrowser((state) => (conversationId ? state.chats[conversationId] : undefined));
  const tabs = useAgentBrowser((state) => state.tabs);
  const [takenOver, setTakenOver] = useState(false);
  if (!chat?.expanded || !chat.views.length) return null;
  const view = chat.views.find((item) => item.id === chat.shownView) ?? chat.views[0]!;
  const shown = tabs[view.shownScope];
  const runId = agentTab(view.shownScope)?.runId;
  const working = view.status === "working";
  const hold = async (takeOver: boolean) => {
    if (!runId) return;
    if (takeOver) await aiSurfaceApi.pauseInvocation(runId);
    else await aiSurfaceApi.resumeInvocation(runId);
    setTakenOver(takeOver);
  };
  return (
    <section className="agent-browser" aria-label="Agent browser">
      <header className="agent-browser-head">
        <AgentViewSwitcher chat={chat} />
        <div className="agent-browser-tabs" role="tablist" aria-label={`${view.label} tabs`}>
          {view.tabs.map((scope) => (
            <button
              key={scope}
              type="button"
              role="tab"
              aria-selected={scope === view.shownScope}
              className="agent-browser-tab"
              onClick={() => showViewTab(chat.conversationId, view.id, scope)}
            >
              {tabLabel(tabs[scope])}
            </button>
          ))}
        </div>
        {working && !takenOver && (
          <IconButton label="Take over" onClick={() => void hold(true)}>
            <Hand />
          </IconButton>
        )}
        {takenOver && (
          <Button size="sm" variant="primary" onClick={() => void hold(false)}>
            <Play aria-hidden="true" />
            Resume
          </Button>
        )}
        <IconButton label="Shrink to a picture" onClick={() => setBrowserExpanded(chat.conversationId, false)}>
          <PictureInPicture2 />
        </IconButton>
      </header>
      <div className="agent-browser-address">
        <span className="agent-browser-url">{shown?.url ?? ""}</span>
        {shown?.url && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => useWorkspaceStore.getState().openBrowserView({ url: shown.url })}
          >
            Move to my tabs
          </Button>
        )}
      </div>
      <AgentBrowserStage scopeId={view.shownScope} locked={working && !takenOver} />
    </section>
  );
}
