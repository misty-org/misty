// Layout adapted from OpenChamber (MIT, Copyright (c) 2025 Bohdan Triapitsyn).
import {
  FolderTree,
  GitCompareArrows,
  Globe,
  ListOrdered,
  MonitorPlay,
  PanelRightClose,
  Pin,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";
import { lazy, Suspense, useEffect, useRef } from "react";
import type { AgentProfile } from "@/shared/schemas";
import { cn, IconButton, RowTools, SideCard, SidePanel } from "@/shared/ui";
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

/**
 * Whether a side panel (a context view, or the agent browser holding the slot) shows beside this
 * chat. The session card goes behind any of them while one does, and comes back as it closes.
 */
export function useSidePanelShown(conversationId: string) {
  const tab = useContextPanel((state) => state.tab);
  const browserOpen = useAgentBrowser((state) =>
    isBrowserOpen(state.chats[chatKey(conversationId)]),
  );
  return tab !== null || browserOpen;
}

// How the panel gives way on a narrow Agents page (its `agent-studio` container). Important,
// since the shared panel's own geometry is in its stylesheet.
/** On a narrow page the open panel covers the chat instead of squeezing it. */
const narrowPanelClass = cn(
  "@max-[761px]/agent-studio:absolute!",
  "@max-[761px]/agent-studio:inset-[--spacing(2)_--spacing(1)_--spacing(2)_--spacing(2)]!",
  "@max-[761px]/agent-studio:w-auto! @max-[761px]/agent-studio:max-w-none!",
  "@max-[761px]/agent-studio:m-0!",
);
/**
 * The right side of a chat, after the chat column and before the rail: the floating side panel
 * (the agent browser, the preview, steps, or the project folder's changes, files and terminal).
 * The session card floats over the chat itself (`ChatSessionCard`), so it takes no width here.
 */
export function ChatSidePanels(props: { conversationId: string; agent: AgentProfile }) {
  const tab = useContextPanel((state) => state.tab);
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
    </>
  );
}

/**
 * The session card, a narrow glance at the chat's usage and where it works, floating over the
 * chat's top right corner: it takes none of the chat's width, and goes behind any side panel
 * while one is open (`useSidePanelShown`). Its parent is the chat's positioned column. Its corner button tucks
 * it off the chat's edge, where resting the pointer brings it back; pressed there, it stays.
 */
export function ChatSessionCard(props: { conversationId: string; agent: AgentProfile }) {
  const session = useContextPanel((state) => state.session);
  const tucked = useContextPanel((state) => state.sessionTucked);
  const setTucked = useContextPanel((state) => state.setSessionTucked);
  // Never beside a side panel: it stays open underneath and shows again once the panel closes.
  const covered = useSidePanelShown(props.conversationId);
  if (!session || covered) return null;
  const corner = (
    <RowTools>
      <IconButton
        label={tucked ? "Keep open" : "Hide to the edge"}
        tooltipSide="bottom"
        onClick={() => setTucked(!tucked)}
      >
        {tucked ? <Pin /> : <PanelRightClose />}
      </IconButton>
    </RowTools>
  );
  return (
    <SideCard
      label="Session"
      floating
      tucked={tucked}
      className="agent-studio-session context-panel"
    >
      <Suspense fallback={<SessionSkeleton />}>
        <SessionPanel conversationId={props.conversationId} agent={props.agent} corner={corner} />
      </Suspense>
    </SideCard>
  );
}
