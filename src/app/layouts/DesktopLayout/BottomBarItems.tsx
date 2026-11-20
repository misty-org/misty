import {
  Activity,
  AudioLines,
  CircleHelp,
  CircleX,
  Clock,
  Coins,
  Cpu,
  FileCode,
  Focus,
  FolderOpen,
  Gauge,
  GitBranch,
  Globe,
  Info,
  Keyboard,
  LayoutDashboard,
  Locate,
  MessageSquareDot,
  MousePointer2,
  Orbit,
  Palette,
  PanelLeft,
  PanelRight,
  Plus,
  RadioTower,
  Search,
  Server,
  ServerCog,
  ShieldCheck,
  SquarePen,
  SquareTerminal,
  SunMoon,
  TextCursorInput,
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
  CodeBranchStatus,
  CodeCursorStatus,
  CodeLanguageStatus,
  CodeLiveStatus,
  CodeProblemsStatus,
  CodeServerStatus,
  CodeTerminalButton,
  CodeThemeStatus,
  CodeVimStatus,
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
  FocusButton,
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
    description: "The branch of the focused chat or Code page, with its uncommitted lines.",
    icon: GitBranch,
    side: "end",
    Item: Branch,
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
  codeVim: {
    label: "Vim mode",
    description: "On the Code page with vim on: normal, insert or visual.",
    icon: TextCursorInput,
    side: "end",
    Item: forCode(CodeVimStatus),
  },
  codeLive: {
    label: "Live session",
    description: "On the Code page: the live session it's in, and who else is there.",
    icon: RadioTower,
    side: "end",
    Item: forCode(CodeLiveStatus),
  },
  codeProblems: {
    label: "Problems",
    description: "On the Code page: the open file's errors and warnings.",
    icon: CircleX,
    side: "end",
    Item: forCode(CodeProblemsStatus),
  },
  codeCursor: {
    label: "Cursor position",
    description: "On the Code page: the cursor's line and column.",
    icon: Locate,
    side: "end",
    Item: forCode(CodeCursorStatus),
  },
  codeLanguage: {
    label: "Language",
    description: "On the Code page: the open file's language.",
    icon: FileCode,
    side: "end",
    Item: forCode(CodeLanguageStatus),
  },
  codeServer: {
    label: "Language server",
    description: "On the Code page: the open file's language server, and its install.",
    icon: ServerCog,
    side: "end",
    Item: forCode(CodeServerStatus),
  },
  codeTheme: {
    label: "Editor theme",
    description: "On the Code page: the editor's theme, to switch it in place.",
    icon: Palette,
    side: "end",
    Item: forCode(CodeThemeStatus),
  },
  codeTerminal: {
    label: "Terminal",
    description: "On the Code page: shows or hides its terminal.",
    icon: SquareTerminal,
    side: "end",
    Item: forCode(CodeTerminalButton),
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
    openWorkspaceRoute(openChatRoute(agentId, conversationId), open);
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

/** The focused Code page's view id, or null while the focused pane shows something else. */
function useFocusedCodeView(): string | null {
  const view = useFocusedView();
  const [path, query = ""] = (view?.route ?? "").split("?");
  return view && path === "/agents" && new URLSearchParams(query).get("view") === "code"
    ? view.id
    : null;
}

/** A Code item, drawn only while the focused pane shows the Code page. */
function forCode(Status: ComponentType<{ viewId: string }>): ComponentType {
  return function CodeItem() {
    const viewId = useFocusedCodeView();
    return viewId ? <Status viewId={viewId} /> : null;
  };
}

const ChatBranch = forChat(BranchStatus);

/** The focused Code page's branch there, else the focused chat's. */
function Branch() {
  const codeView = useFocusedCodeView();
  return codeView ? <CodeBranchStatus viewId={codeView} /> : <ChatBranch />;
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

/** The "i" for the focused pane's page: its tour. A page with no tour leaves it out. */
function PageInfo() {
  const view = useFocusedView();
  const tour = view ? tourForRoute(view.route) : null;
  return tour ? <TourInfoButton tour={tour} /> : null;
}
