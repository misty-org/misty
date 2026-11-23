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
import {
  IconButton,
  SideCard,
  SidePanel,
  lazyTool,
  ToolSuspense,
  type FramedPageColumn,
} from "@misty/ui";
import {
  closeAgentBrowser,
  isBrowserOpen,
  setBrowserExpanded,
  useAgentBrowser,
} from "../agent-browser/agent_browser_store";
import {
  CHAT_MIN_WIDTH,
  PANEL_DEFAULT_WIDTH,
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
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
  steps: ["Steps", ListOrdered],
  changes: ["Changes", GitCompareArrows],
  files: ["Files", FolderTree],
  terminal: ["Terminal", SquareTerminal],
  profile: ["Profile", UserRound],
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

const profileWidth = 256;
const profileMinWidth = 240;

export function useAgentChatSidePanel(props: {
  conversationId: string;
  agent: AgentProfile;
  active: boolean;
  room: number | null;
}): FramedPageColumn | null {
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
  const fits = (minWidth: number) =>
    props.room === null || props.room > CHAT_MIN_WIDTH + minWidth + 1;
  if (surface === "profile")
    return {
      id: "profile",
      label: "Resize the profile",
      width: profileWidth,
      minWidth: profileMinWidth,
      maxWidth: PANEL_MAX_WIDTH,
      expanded: !fits(profileMinWidth),
      content: (
        <SidePanel
          label={`${props.agent.name}'s profile`}
          name={surfaces.profile[0]}
          icon={surfaces.profile[1]}
          onClose={() => panel.close()}
          className="context-panel"
          data-panel="profile"
        >
          <AgentProfileCard agent={props.agent} />
        </SidePanel>
      ),
    };
  const [name, icon] =
    surface === "browser" && logOpen ? (["Browser log", ScrollText] as const) : surfaces[surface];
  return {
    id: surface,
    label: `Resize the ${name.toLowerCase()}`,
    width: PANEL_DEFAULT_WIDTH,
    minWidth: PANEL_MIN_WIDTH,
    maxWidth: PANEL_MAX_WIDTH,
    expanded: expanded || !fits(PANEL_MIN_WIDTH),
    content: (
      <SidePanel
        label={name}
        name={name}
        icon={icon}
        expanded={expanded}
        onToggleExpanded={fits(PANEL_MIN_WIDTH) ? panel.toggleExpanded : undefined}
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
    ),
  };
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
