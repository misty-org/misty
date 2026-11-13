// Layout adapted from OpenChamber (MIT, Copyright (c) 2025 Bohdan Triapitsyn).
import {
  FolderTree,
  GitCompareArrows,
  Globe,
  ListOrdered,
  MonitorPlay,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";
import { lazy, Suspense, useEffect, useRef } from "react";
import type { AgentProfile } from "@/shared/schemas";
import { cn, SideCard, SidePanel } from "@/shared/ui";
import { AgentBrowser } from "../agent-browser/AgentBrowser";
import {
  closeAgentBrowser,
  isBrowserOpen,
  setBrowserExpanded,
  useAgentBrowser,
} from "../agent-browser/agentBrowserStore";
import { useContextPanel, type ContextPanelSurface } from "./contextPanelStore";
import { chatKey } from "../conversations/state/draftChat";
import { ContextPanelSkeleton, SessionSkeleton } from "./PanelSkeletons";

const AgentContextPanel = lazy(async () => ({
  default: (await import("./AgentContextPanel")).AgentContextPanel,
}));
const SessionPanel = lazy(async () => ({
  default: (await import("./SessionPanel")).SessionPanel,
}));

/** What the panel's header names when the open view puts nothing in it. */
const surfaces: Record<ContextPanelSurface | "browser", [name: string, icon: LucideIcon]> = {
  browser: ["Browser", Globe],
  preview: ["Preview", MonitorPlay],
  steps: ["Steps", ListOrdered],
  changes: ["Changes", GitCompareArrows],
  files: ["Files", FolderTree],
  terminal: ["Terminal", SquareTerminal],
};

/**
 * One panel beside a chat, never two stacked: the agent browser and the context views share the
 * slot, and whichever the person (or the agent) opened last takes it. Opening a view while the
 * browser is open shrinks the browser to its picture in the chat; the browser opening closes the
 * view.
 */
function useOnePanel(conversationId: string, tab: ContextPanelSurface | null, browser: boolean) {
  const previous = useRef({ tab, browser });
  useEffect(() => {
    const was = previous.current;
    previous.current = { tab, browser };
    if (browser && !was.browser && tab) useContextPanel.getState().close();
    else if (tab && tab !== was.tab && browser) setBrowserExpanded(conversationId, false);
  }, [conversationId, tab, browser]);
}

// How the panel and the card give way on a narrow Agents page (its `agent-studio` container).
// Important, since the shared panel's own geometry is in its stylesheet.
/** Too narrow for three columns: the card floats at the edge over the panel, under its header. */
const besidePanelCardClass = cn(
  "@max-[1200px]/agent-studio:absolute! @max-[1200px]/agent-studio:top-13!",
  "@max-[1200px]/agent-studio:right-3! @max-[1200px]/agent-studio:m-0!",
  "@max-[1200px]/agent-studio:max-h-[calc(100%-var(--spacing)*16)]!",
);
/** On a narrow page the open panel covers the chat instead of squeezing it… */
const narrowPanelClass = cn(
  "@max-[761px]/agent-studio:absolute!",
  "@max-[761px]/agent-studio:inset-[--spacing(2)_--spacing(1)_--spacing(2)_--spacing(2)]!",
  "@max-[761px]/agent-studio:w-auto! @max-[761px]/agent-studio:max-w-none!",
  "@max-[761px]/agent-studio:m-0!",
);
/** …and the card floats at the edge. */
const narrowCardClass = cn(
  "@max-[761px]/agent-studio:absolute! @max-[761px]/agent-studio:top-2!",
  "@max-[761px]/agent-studio:right-1! @max-[761px]/agent-studio:m-0!",
);

/**
 * The right side of a chat, after the chat column and before the rail: the floating side panel
 * (the agent browser, the preview, steps, or the project folder's changes, files and terminal),
 * then the session card, a narrow glance at the chat's usage and where it works that can stay
 * open beside any of them.
 */
export function ChatSidePanels(props: { conversationId: string; agent: AgentProfile }) {
  const tab = useContextPanel((state) => state.tab);
  const session = useContextPanel((state) => state.session);
  const width = useContextPanel((state) => state.width);
  const expanded = useContextPanel((state) => state.expanded);
  // A chat that hasn't started keeps its browser under the draft key until it does.
  const browserChat = chatKey(props.conversationId);
  const browserOpen = useAgentBrowser((state) => isBrowserOpen(state.chats[browserChat]));
  useOnePanel(browserChat, tab, browserOpen);
  const surface = tab ?? (browserOpen ? "browser" : null);
  const panel = useContextPanel.getState();
  const [name, icon] = surface ? surfaces[surface] : ["", Globe];
  return (
    <>
      {surface ? (
        <SidePanel
          label={name}
          name={name}
          icon={icon}
          width={width}
          expanded={expanded}
          onResize={panel.setWidth}
          onToggleExpanded={panel.toggleExpanded}
          onClose={() =>
            surface === "browser" ? closeAgentBrowser(browserChat) : panel.close()
          }
          className={cn("agent-studio-context context-panel", narrowPanelClass)}
          data-panel={surface}
        >
          {surface === "browser" ? (
            <AgentBrowser key={browserChat} conversationId={browserChat} />
          ) : (
            // While the panel's code loads, the open view's own shape, never a blank box.
            <Suspense fallback={<ContextPanelSkeleton tab={surface} />}>
              <AgentContextPanel
                tab={surface}
                conversationId={props.conversationId}
                agent={props.agent}
              />
            </Suspense>
          )}
        </SidePanel>
      ) : null}
      {session ? (
        <SideCard
          label="Session"
          className={cn(
            "agent-studio-session context-panel",
            surface && besidePanelCardClass,
            narrowCardClass,
          )}
        >
          <Suspense fallback={<SessionSkeleton />}>
            <SessionPanel conversationId={props.conversationId} agent={props.agent} />
          </Suspense>
        </SideCard>
      ) : null}
    </>
  );
}
