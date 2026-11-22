import {
  Activity,
  AudioLines,
  CircleHelp,
  Clock,
  Coins,
  Cpu,
  FolderOpen,
  Gauge,
  GitBranch,
  Globe,
  Info,
  Keyboard,
  LayoutDashboard,
  MessageSquareDot,
  MousePointer2,
  Orbit,
  PanelLeft,
  PanelRight,
  Plus,
  Search,
  Server,
  ShieldCheck,
  SquarePen,
  SunMoon,
  UsersRound,
  WifiOff,
  ZoomIn,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import { dockLeaves, useWorkspaceStore } from "@/features/app-windows";
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
} from "@/features/agents";
import { TourInfoButton, tourForRoute } from "@/features/onboarding";
import { SpaceBarMenu, SpacePresence } from "@/features/spaces";
import { CaptureBarStatus } from "@/features/voice";
import { Button, StateMark } from "@misty/ui";
import {
  HelpButton,
  LayoutButton,
  MistyPanelButton,
  NewChatButton,
  NewTabButton,
  SearchButton,
  ShortcutsButton,
  SidebarButton,
  ThemeButton,
  ZoomLevel,
} from "./BottomBarButtons";
import { useBottomBarOpen as useOpen } from "./bottomBarOpenContext";
import { ConnectionProblem, ServerStatus } from "./ServerStatusItems";
import { openChatRoute, openWorkspaceRoute } from "./spaceNavigation";
import type { BottomBarItemId } from "./bottomBarStore";

export { BottomBarOpenContext } from "./bottomBarOpenContext";

type BarItem = {
  label: string;
  description: string;
  icon: LucideIcon;
  side: "start" | "end";
  Item: ComponentType;
};

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
    description: "The branch of the focused chat, with its uncommitted lines.",
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

function useOpenChat() {
  const open = useOpen();
  return (agentId: string, conversationId: string) =>
    openWorkspaceRoute(openChatRoute(agentId, conversationId), open);
}

function useFocusedView() {
  return useWorkspaceStore((state) => {
    const pane = dockLeaves(state.layout.root).find(
      (leaf) => leaf.id === state.layout.focusedPaneId,
    );
    const view = pane?.views.find((item) => item.id === pane.activeViewId);
    return view && !view.placeholder ? view : undefined;
  });
}

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

function PageInfo() {
  const view = useFocusedView();
  const tour = view ? tourForRoute(view.route) : null;
  return tour ? <TourInfoButton tour={tour} /> : null;
}
