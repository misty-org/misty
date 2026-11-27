// Layout adapted from OpenChamber (MIT, Copyright (c) 2025 Bohdan Triapitsyn).
import {
  BookOpenText,
  FolderTree,
  GitCompareArrows,
  Globe,
  ListOrdered,
  ScrollText,
  SquareTerminal,
  Target,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";
import type { AgentProfile } from "@/shared/schemas";
import type { ReactNode } from "react";
import { SideCard, SidePanel, lazyTool, profileIcons, ToolSuspense } from "@misty/ui";
import { AgentMemoryPage } from "../memory/AgentMemoryPage";
import { SessionGoalPanel } from "../goals/SessionGoalPanel";
import { homeSpaceOf } from "../personal/agent_home_space";
import {
  closeAgentBrowser,
  isBrowserOpen,
  setBrowserExpanded,
  useAgentBrowser,
} from "../agent-browser/agent_browser_store";
import {
  PANEL_DEFAULT_WIDTH,
  useContextPanel,
  type ContextPanelSurface,
} from "./context_panel_store";
import { chatKey } from "../conversations/state/draft_chat";
import { closeBrowserLog, useBrowserLog } from "../browser-log/browser_log_store";
import { AgentProfileCard } from "./AgentProfileCard";

const AgentContextPanel = lazyTool(async () => ({
  default: (await import("./AgentContextPanel")).AgentContextPanel,
}));
const SessionPanel = lazyTool(async () => ({
  default: (await import("./SessionPanel")).SessionPanel,
}));
const AgentBrowser = lazyTool(async () => ({
  default: (await import("../agent-browser/AgentBrowser")).AgentBrowser,
}));

const surfaces: Record<ContextPanelSurface | "browser", [name: string, icon: LucideIcon]> = {
  browser: ["Browser", Globe],
  goal: ["Goal", Target],
  steps: ["Steps", ListOrdered],
  changes: ["Changes", GitCompareArrows],
  files: ["Files", FolderTree],
  terminal: ["Terminal", SquareTerminal],
  memory: ["Memory", BookOpenText],
  profile: ["Profile", profileIcons.agent],
};

function useOnePanel(
  conversationId: string,
  tab: ContextPanelSurface | null,
  browser: boolean,
  active: boolean,
) {
  const previous = useRef({ tab, browser });
  useEffect(() => {
    const was = previous.current;
    previous.current = { tab, browser };
    if (!active) return;
    if (browser && !was.browser && tab) useContextPanel.getState().close();
    else if (tab && tab !== was.tab && browser) {
      setBrowserExpanded(conversationId, false);
      closeBrowserLog(conversationId);
    }
  }, [conversationId, tab, browser, active]);
}

export function useSidePanelShown(conversationId: string) {
  const tab = useContextPanel((state) => state.tab);
  const browserOpen = useAgentBrowser((state) =>
    isBrowserOpen(state.chats[chatKey(conversationId)]),
  );
  const logOpen = useBrowserLog((state) => Boolean(state.chats[chatKey(conversationId)]));
  return tab !== null || browserOpen || logOpen;
}

const profileWidth = 288;

export function useAgentChatSidePanel(props: {
  conversationId: string;
  agent: AgentProfile;
  accountId: string;
  active: boolean;
}): ReactNode {
  const tab = useContextPanel((state) => state.tab);
  const expanded = useContextPanel((state) => state.expanded);
  const browserChat = chatKey(props.conversationId);
  const browserShown = useAgentBrowser((state) => isBrowserOpen(state.chats[browserChat]));
  const logOpen = useBrowserLog((state) => Boolean(state.chats[browserChat]));
  const browserOpen = browserShown || logOpen;
  useOnePanel(browserChat, tab, browserOpen, props.active);
  const surface = tab ?? (browserOpen ? "browser" : null);
  if (!props.active || !surface) return null;
  const panel = useContextPanel.getState();
  if (surface === "profile")
    return (
      <SidePanel
        floating
        width={profileWidth}
        label={`${props.agent.name}'s profile`}
        name={surfaces.profile[0]}
        icon={surfaces.profile[1]}
        onClose={() => panel.close()}
        className="context-panel"
        data-panel="profile"
      >
        <AgentProfileCard agent={props.agent} />
      </SidePanel>
    );
  const [name, icon] =
    surface === "browser" && logOpen ? (["Browser log", ScrollText] as const) : surfaces[surface];
  return (
    <SidePanel
      floating
      width={PANEL_DEFAULT_WIDTH}
      label={name}
      name={name}
      icon={icon}
      expanded={expanded}
      onToggleExpanded={panel.toggleExpanded}
      onClose={() => {
        if (surface !== "browser") return panel.close();
        closeBrowserLog(browserChat);
        closeAgentBrowser(browserChat);
      }}
      className="agent-studio-context context-panel"
      data-panel={surface}
    >
      {surface === "browser" ? (
        <ToolSuspense tool="browser">
          <AgentBrowser key={browserChat} conversationId={browserChat} />
        </ToolSuspense>
      ) : surface === "goal" ? (
        <SessionGoalPanel key={browserChat} conversationId={browserChat} />
      ) : surface === "memory" ? (
        <AgentMemoryPage
          accountId={props.accountId}
          agentId={props.agent.id}
          agentName={props.agent.name}
          engine={props.agent.engine}
          conversationId={props.conversationId}
          spaceId={
            props.agent.system_managed ? undefined : homeSpaceOf(props.accountId, props.agent)
          }
        />
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
  );
}

export function ChatSessionCard(props: { conversationId: string; agent: AgentProfile }) {
  const session = useContextPanel((state) => state.session);
  const covered = useSidePanelShown(props.conversationId);
  if (!session || covered) return null;
  return (
    <SideCard label="Session" floating className="agent-studio-session context-panel">
      <ToolSuspense tool="session card" size="inline">
        <SessionPanel conversationId={props.conversationId} agent={props.agent} />
      </ToolSuspense>
    </SideCard>
  );
}
