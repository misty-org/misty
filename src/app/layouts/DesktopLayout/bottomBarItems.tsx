import {
  Activity,
  AudioLines,
  CircleHelp,
  Clock,
  Coins,
  Cpu,
  Focus,
  FolderOpen,
  Gauge,
  GitBranch,
  Globe,
  Info,
  Keyboard,
  LayoutDashboard,
  MessageSquareDot,
  Moon,
  MousePointer2,
  Orbit,
  PanelLeft,
  PanelRight,
  Plus,
  Search,
  Server,
  ShieldCheck,
  SquarePen,
  Sun,
  SunMoon,
  UsersRound,
  WifiOff,
  ZoomIn,
  type LucideIcon,
} from "lucide-react";
import { createContext, useContext, type ComponentType } from "react";
import { currentApiBase, isMistyCloud, useServerChoice } from "@/api/deployment/serverChoice";
import { useFocusModeStore, useSidebarCollapsedStore } from "@/app/shell";
import {
  dockLeaves,
  setBrowserWebviewsSuspended,
  useLayoutEditor,
  useWorkspaceStore,
  type WorkspaceView,
} from "@/features/app-windows";
import {
  AgentBrowsingStatus,
  ApprovalsStatus,
  BranchStatus,
  ChatModelStatus,
  ContextStatus,
  CostStatus,
  FolderStatus,
  openAgentsHub,
  RunTimeStatus,
  TutorStatus,
  UnreadStatus,
  useChatStatuses,
  useMistyPanelStore,
} from "@/features/agents";
import { TourInfoButton, tourForRoute } from "@/features/onboarding";
import { openSettings, useAppThemeStore, useSettingsStore } from "@/features/settings";
import { SpaceBarMenu, SpacePresence, useSpacesConnection } from "@/features/spaces";
import { CaptureBarStatus } from "@/features/voice";
import { appZoomDefault, setAppZoom, useAppZoomValue } from "@/shared/hooks/useAppZoom";
import { Button, IconButton, StateMark, Tooltip } from "@/shared/ui";
import { useHelpDialog } from "./HelpDialog";
import { useSearchDialog } from "./search/searchStore";
import { agentChatRoute, openNewChat, openNewTab, openWorkspaceRoute } from "./spaceNavigation";
import type { BottomBarItemId } from "./bottomBarStore";

/** How a bar item opens a page: the canvas's own `openTab`, so it focuses and routes as a tab does. */
export const BottomBarOpenContext = createContext<(view: WorkspaceView) => void>(() => {});
const useOpen = () => useContext(BottomBarOpenContext);

type BarItem = {
  label: string;
  /** One line for its tile in Settings. */
  description: string;
  icon: LucideIcon;
  /** Where it goes when added: window-wide status on the left, the page in view on the right. */
  side: "start" | "end";
  Item: ComponentType;
};

/**
 * Everything the window's bottom bar can show (Settings › Interface › Bottom bar), in the order
 * the setting lists them. Most draw nothing until they have something to say, so a calm window
 * shows a calm bar; the chat items read the focused pane's chat.
 */
export const bottomBarItems: Record<BottomBarItemId, BarItem> = {
  agents: {
    label: "Agent activity",
    description: "How many agents are working, and how many wait on you.",
    icon: Activity,
    side: "start",
    Item: AgentActivity,
  },
  server: {
    label: "Server",
    description: "The server this computer uses, and whether it's connected.",
    icon: Server,
    side: "start",
    Item: ServerStatus,
  },
  connection: {
    label: "Connection problems",
    description: "Only while the server can't be reached.",
    icon: WifiOff,
    side: "start",
    Item: ConnectionProblem,
  },
  space: {
    label: "Space",
    description: "The window's Space, to switch it from anywhere.",
    icon: Orbit,
    side: "start",
    Item: SpaceBarMenu,
  },
  presence: {
    label: "Who's here",
    description: "How many others are in this Space right now.",
    icon: UsersRound,
    side: "start",
    Item: SpacePresence,
  },
  approvals: {
    label: "Approvals",
    description: "Tool calls waiting for your OK, in any chat.",
    icon: ShieldCheck,
    side: "start",
    Item: Approvals,
  },
  unread: {
    label: "Unread chats",
    description: "Chats that replied while you were elsewhere.",
    icon: MessageSquareDot,
    side: "start",
    Item: Unread,
  },
  browsing: {
    label: "Agent browsing",
    description: "An agent using its browser in a chat you can't see.",
    icon: Globe,
    side: "start",
    Item: Browsing,
  },
  tutor: {
    label: "Tutor",
    description: "While Tutor is on: listening, thinking or speaking.",
    icon: MousePointer2,
    side: "start",
    Item: TutorStatus,
  },
  recording: {
    label: "Recording",
    description: "While a capture records: its time, and a stop button.",
    icon: AudioLines,
    side: "start",
    Item: CaptureBarStatus,
  },
  model: {
    label: "Chat model",
    description: "The model the focused chat uses.",
    icon: Cpu,
    side: "end",
    Item: forChat(ChatModelStatus),
  },
  context: {
    label: "Context used",
    description: "How full the focused chat's context window is.",
    icon: Gauge,
    side: "end",
    Item: forChat(ContextStatus),
  },
  cost: {
    label: "Chat cost",
    description: "What the focused chat has cost on your keys.",
    icon: Coins,
    side: "end",
    Item: forChat(CostStatus),
  },
  branch: {
    label: "Branch",
    description: "The focused chat's branch, with its uncommitted lines.",
    icon: GitBranch,
    side: "end",
    Item: forChat(BranchStatus),
  },
  folder: {
    label: "Folder",
    description: "The folder the focused chat works in.",
    icon: FolderOpen,
    side: "end",
    Item: forChat(FolderStatus),
  },
  runtime: {
    label: "Run time",
    description: "How long the focused chat's reply has been running.",
    icon: Clock,
    side: "end",
    Item: forChat(RunTimeStatus),
  },
  newChat: {
    label: "New chat",
    description: "Starts a chat with the agent you used last.",
    icon: SquarePen,
    side: "end",
    Item: NewChatButton,
  },
  newTab: {
    label: "New tab",
    description: "Opens an empty tab.",
    icon: Plus,
    side: "end",
    Item: NewTabButton,
  },
  search: {
    label: "Search",
    description: "Opens search, the same as ⌘K.",
    icon: Search,
    side: "end",
    Item: SearchButton,
  },
  layout: {
    label: "Layout",
    description: "Splits the window into panes.",
    icon: LayoutDashboard,
    side: "end",
    Item: LayoutButton,
  },
  mistyPanel: {
    label: "Misty panel",
    description: "Shows or hides the Misty panel beside the page.",
    icon: PanelRight,
    side: "end",
    Item: MistyPanelButton,
  },
  sidebar: {
    label: "Sidebar",
    description: "Shows or hides the sidebar.",
    icon: PanelLeft,
    side: "end",
    Item: SidebarButton,
  },
  focus: {
    label: "Focus mode",
    description: "Hides the window's chrome around the page.",
    icon: Focus,
    side: "end",
    Item: FocusButton,
  },
  theme: {
    label: "Theme",
    description: "Switches between the light and dark theme.",
    icon: SunMoon,
    side: "end",
    Item: ThemeButton,
  },
  help: {
    label: "Help",
    description: "Opens Help.",
    icon: CircleHelp,
    side: "end",
    Item: HelpButton,
  },
  zoom: {
    label: "Zoom",
    description: "The app's zoom, only while it isn't 100%. Click to reset.",
    icon: ZoomIn,
    side: "end",
    Item: ZoomLevel,
  },
  shortcuts: {
    label: "Shortcuts",
    description: "Opens the keyboard shortcuts.",
    icon: Keyboard,
    side: "end",
    Item: ShortcutsButton,
  },
  info: {
    label: "Page info",
    description: "The focused page's tour.",
    icon: Info,
    side: "end",
    Item: PageInfo,
  },
};

function Approvals() {
  return <ApprovalsStatus onOpenChat={useOpenChat()} />;
}

function Unread() {
  return <UnreadStatus onOpenChat={useOpenChat()} />;
}

function Browsing() {
  return <AgentBrowsingStatus onOpenChat={useOpenChat()} />;
}

/** Opens an agent's chat in this window, as the sidebar does. */
function useOpenChat() {
  const open = useOpen();
  return (agentId: string, conversationId: string) =>
    openWorkspaceRoute(agentChatRoute(agentId, conversationId), open);
}

/** The focused pane's view, unless it is an unused new tab. */
function useFocusedView() {
  return useWorkspaceStore((state) => {
    const pane = dockLeaves(state.layout.root).find(
      (leaf) => leaf.id === state.layout.focusedPaneId,
    );
    const view = pane?.views.find((item) => item.id === pane.activeViewId);
    return view && !view.placeholder ? view : undefined;
  });
}

/** A chat item, drawn only while the focused pane shows a chat. */
function forChat(Status: ComponentType<{ conversationId: string }>): ComponentType {
  return function ChatItem() {
    const route = useFocusedView()?.route ?? "";
    const [path, query = ""] = route.split("?");
    const params = new URLSearchParams(query);
    const conversationId =
      path === "/agents" && !params.get("view") ? params.get("conversation") : null;
    return conversationId ? <Status conversationId={conversationId} /> : null;
  };
}

/** How many agents are working and how many wait on the person, while any do. */
function AgentActivity() {
  const statuses = Object.values(useChatStatuses());
  const working = statuses.filter((status) => status === "working").length;
  const waiting = statuses.filter((status) => status === "needs-you").length;
  if (!working && !waiting) return null;
  return (
    <>
      {working ? (
        <Button variant="quiet" icon={<StateMark kind="working" />} onClick={() => openAgentsHub()}>
          {`${working} working`}
        </Button>
      ) : null}
      {waiting ? (
        <Button variant="quiet" icon={<StateMark kind="waiting" />} onClick={() => openAgentsHub()}>
          {`${waiting} ${waiting === 1 ? "needs" : "need"} you`}
        </Button>
      ) : null}
    </>
  );
}

function useServerName(): string {
  const choice = useServerChoice((state) => state.choice);
  const base = choice ? (choice.mode === "server" ? choice.url : "") : currentApiBase();
  if (!base) return "";
  if (isMistyCloud(choice)) return "Misty Cloud";
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
}

/** The server this device uses, with its live connection's state. Opens Settings › Server. */
function ServerStatus() {
  const name = useServerName();
  const connection = useSpacesConnection((state) => state.state);
  if (!name) return null;
  const mark =
    connection === "connected"
      ? "online"
      : connection === "reconnecting"
        ? "waiting"
        : connection === "connecting"
          ? "working"
          : null;
  return (
    <Button
      variant="quiet"
      icon={mark ? <StateMark kind={mark} label={markLabel[mark]} /> : Server}
      onClick={() => openSettings("server")}
    >
      {connection === "reconnecting" ? `Reconnecting to ${name}` : name}
    </Button>
  );
}

const markLabel = { online: "Connected", waiting: "Reconnecting", working: "Connecting" } as const;

/** Only while the live line to the server is down. Opens Settings › Server. */
function ConnectionProblem() {
  const name = useServerName();
  const connection = useSpacesConnection((state) => state.state);
  if (!name || connection !== "reconnecting") return null;
  return (
    <Button
      variant="quiet"
      icon={<StateMark kind="waiting" label="Reconnecting" />}
      onClick={() => openSettings("server")}
    >
      {`Can't reach ${name}`}
    </Button>
  );
}

/** The app's zoom, only while it isn't 100%. Resets it. */
function ZoomLevel() {
  const zoom = useAppZoomValue();
  if (zoom === appZoomDefault) return null;
  return (
    <Tooltip content="Reset to 100%">
      <Button variant="quiet" icon={ZoomIn} onClick={() => setAppZoom(appZoomDefault)}>
        {`${Math.round(zoom * 100)}%`}
      </Button>
    </Tooltip>
  );
}

function ShortcutsButton() {
  return (
    <IconButton label="Shortcuts" onClick={() => openSettings("shortcuts")}>
      <Keyboard />
    </IconButton>
  );
}

function NewChatButton() {
  const open = useOpen();
  return (
    <IconButton label="New chat" onClick={() => openNewChat(open)}>
      <SquarePen />
    </IconButton>
  );
}

function NewTabButton() {
  const open = useOpen();
  return (
    <IconButton label="New tab" onClick={() => openNewTab(open)}>
      <Plus />
    </IconButton>
  );
}

function SearchButton() {
  return (
    <IconButton label="Search" onClick={() => useSearchDialog.getState().setOpen(true)}>
      <Search />
    </IconButton>
  );
}

function LayoutButton() {
  const active = useLayoutEditor((state) => state.active);
  return (
    <IconButton
      label="Layout"
      aria-pressed={active}
      onClick={() => useLayoutEditor.getState().toggle()}
    >
      <LayoutDashboard />
    </IconButton>
  );
}

function MistyPanelButton() {
  const open = useMistyPanelStore((state) => state.chatOpen);
  return (
    <IconButton
      label={open ? "Hide the Misty panel" : "Show the Misty panel"}
      aria-pressed={open}
      onClick={() => useMistyPanelStore.getState().toggle()}
    >
      <PanelRight />
    </IconButton>
  );
}

function SidebarButton() {
  const collapsed = useSidebarCollapsedStore((state) => state.collapsed);
  return (
    <IconButton
      label={collapsed ? "Show the sidebar" : "Hide the sidebar"}
      aria-pressed={!collapsed}
      onClick={() => useSidebarCollapsedStore.getState().toggle()}
    >
      <PanelLeft />
    </IconButton>
  );
}

/** Turns focus mode on; the bar hides with the rest of the chrome, and its shortcut brings it back. */
function FocusButton() {
  return (
    <IconButton
      label="Focus mode"
      onClick={() => {
        // Native pages hide while the chrome animates, as the shortcut does.
        setBrowserWebviewsSuspended(true, "focus-mode");
        useFocusModeStore.getState().toggle();
        window.setTimeout(() => setBrowserWebviewsSuspended(false, "focus-mode"), 320);
      }}
    >
      <Focus />
    </IconButton>
  );
}

function ThemeButton() {
  const dark = useAppThemeStore((state) => state.resolvedTheme) === "dark";
  return (
    <IconButton
      label={dark ? "Switch to the light theme" : "Switch to the dark theme"}
      onClick={() =>
        useSettingsStore
          .getState()
          .updateSetting("appearance", "theme_mode", dark ? "light" : "dark")
      }
    >
      {dark ? <Sun /> : <Moon />}
    </IconButton>
  );
}

function HelpButton() {
  return (
    <IconButton label="Help" onClick={() => useHelpDialog.getState().setOpen(true)}>
      <CircleHelp />
    </IconButton>
  );
}

/** The "i" for the focused pane's page: its tour. A page with no tour leaves it out. */
function PageInfo() {
  const view = useFocusedView();
  const tour = view ? tourForRoute(view.route) : null;
  return tour ? <TourInfoButton tour={tour} /> : null;
}
