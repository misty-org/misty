// Layout adapted from OpenChamber (MIT, Copyright (c) 2025 Bohdan Triapitsyn).
import {
  FolderTree,
  GitCompareArrows,
  Globe,
  ListOrdered,
  Pin,
  ScrollText,
  SquareTerminal,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";
import type { AgentProfile } from "@/shared/schemas";
import { cn, IconButton, SideCard, SidePanel, lazyTool, ToolSuspense } from "@misty/ui";
import { AgentBrowser } from "../agent-browser/AgentBrowser";
import {
  closeAgentBrowser,
  isBrowserOpen,
  setBrowserExpanded,
  useAgentBrowser,
} from "../agent-browser/agent_browser_store";
import { useContextPanel, type ContextPanelSurface } from "./context_panel_store";
import { chatKey } from "../conversations/state/draft_chat";
import { closeBrowserLog, useBrowserLog } from "../browser-log/browser_log_store";
import { AgentProfileCard } from "./AgentProfileCard";

const AgentContextPanel = lazyTool(async () => ({
  default: (await import("./AgentContextPanel")).AgentContextPanel,
}));
const SessionPanel = lazyTool(async () => ({
  default: (await import("./SessionPanel")).SessionPanel,
}));

const surfaces: Record<ContextPanelSurface | "browser", [name: string, icon: LucideIcon]> = {
  browser: ["Browser", Globe],
  steps: ["Steps", ListOrdered],
  changes: ["Changes", GitCompareArrows],
  files: ["Files", FolderTree],
  terminal: ["Terminal", SquareTerminal],
  profile: ["Profile", UserRound],
};

function useOnePanel(conversationId: string, tab: ContextPanelSurface | null, browser: boolean) {
  const previous = useRef({ tab, browser });
  useEffect(() => {
    const was = previous.current;
    previous.current = { tab, browser };
    if (browser && !was.browser && tab) useContextPanel.getState().close();
    else if (tab && tab !== was.tab && browser) {
      setBrowserExpanded(conversationId, false);
      closeBrowserLog(conversationId);
    }
  }, [conversationId, tab, browser]);
}

export function useSidePanelShown(conversationId: string) {
  const tab = useContextPanel((state) => state.tab);
  const browserOpen = useAgentBrowser((state) =>
    isBrowserOpen(state.chats[chatKey(conversationId)]),
  );
  const logOpen = useBrowserLog((state) => Boolean(state.chats[chatKey(conversationId)]));
  return tab !== null || browserOpen || logOpen;
}

const narrowPanelClass = cn(
  "@max-[47.5625rem]/agent-studio:absolute!",
  "@max-[47.5625rem]/agent-studio:inset-[--spacing(2)_--spacing(1)_--spacing(2)_--spacing(2)]!",
  "@max-[47.5625rem]/agent-studio:w-auto! @max-[47.5625rem]/agent-studio:max-w-none!",
  "@max-[47.5625rem]/agent-studio:m-0!",
);
export function ChatSidePanels(props: { conversationId: string; agent: AgentProfile }) {
  const tab = useContextPanel((state) => state.tab);
  const width = useContextPanel((state) => state.width);
  const expanded = useContextPanel((state) => state.expanded);
  const browserChat = chatKey(props.conversationId);
  const browserShown = useAgentBrowser((state) => isBrowserOpen(state.chats[browserChat]));
  const logOpen = useBrowserLog((state) => Boolean(state.chats[browserChat]));
  const browserOpen = browserShown || logOpen;
  useOnePanel(browserChat, tab, browserOpen);
  const surface = tab ?? (browserOpen ? "browser" : null);
  const panel = useContextPanel.getState();
  const [name, icon] = surface
    ? surface === "browser" && logOpen
      ? (["Browser log", ScrollText] as const)
      : surfaces[surface]
    : ["", Globe];
  return (
    <>
      {surface === "profile" ? (
        <AgentProfileCard agent={props.agent} onClose={() => panel.close()} />
      ) : surface ? (
        <SidePanel
          label={name}
          name={name}
          icon={icon}
          width={width}
          expanded={expanded}
          onResize={panel.setWidth}
          onToggleExpanded={panel.toggleExpanded}
          onClose={() => {
            if (surface !== "browser") return panel.close();
            closeBrowserLog(browserChat);
            closeAgentBrowser(browserChat);
          }}
          className={cn("agent-studio-context context-panel", narrowPanelClass)}
          data-panel={surface}
        >
          {surface === "browser" ? (
            <AgentBrowser key={browserChat} conversationId={browserChat} />
          ) : (
            <ToolSuspense tool={surface === "terminal" ? "terminal" : `${surface} view`}>
              <AgentContextPanel
                tab={surface}
                conversationId={props.conversationId}
                agent={props.agent}
              />
            </ToolSuspense>
          )}
        </SidePanel>
      ) : null}
    </>
  );
}

export function ChatSessionCard(props: { conversationId: string; agent: AgentProfile }) {
  const session = useContextPanel((state) => state.session);
  const tucked = useContextPanel((state) => state.sessionTucked);
  const setTucked = useContextPanel((state) => state.setSessionTucked);
  const covered = useSidePanelShown(props.conversationId);
  if (!session || covered) return null;
  const pinned = !tucked;
  const corner = (
    <IconButton
      label={pinned ? "Unpin" : "Pin open"}
      hint={pinned ? "Unpin: hide to the edge" : "Pin open"}
      tooltipSide="bottom"
      aria-pressed={pinned}
      onClick={() => setTucked(pinned)}
    >
      <Pin fill={pinned ? "currentColor" : "none"} />
    </IconButton>
  );
  return (
    <SideCard
      label="Session"
      floating
      tucked={tucked}
      className="agent-studio-session context-panel"
    >
      <ToolSuspense tool="session card" size="inline">
        <SessionPanel conversationId={props.conversationId} agent={props.agent} corner={corner} />
      </ToolSuspense>
    </SideCard>
  );
}
