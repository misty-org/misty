import { create } from "zustand";
import { persist } from "zustand/middleware";
import { homeApi } from "@/api/home/api";
import {
  ArrowLeftRight,
  Blocks,
  BookOpenText,
  Bot,
  CheckSquare2,
  Code2,
  FolderOpen,
  Globe2,
  House,
  Inbox,
  MessagesSquare,
  Notebook,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";
import type { WorkspaceSurfaceId, WorkspaceTab } from "./model";
import { spaceWorkspaceToolFromRoute } from "./routeSurface";

export type WorkspaceToolId =
  | "home"
  | "journal"
  | "planner"
  | "social"
  | "library"
  | "inbox"
  | "browser"
  | "code"
  | "files"
  | "transfers"
  | "terminal"
  | "agents"
  | "marketplace";

export interface WorkspaceToolMeta {
  id: WorkspaceToolId;
  label: string;
  surfaceId: WorkspaceSurfaceId;
  icon: LucideIcon;
}

export const WORKSPACE_TOOLS_META: Record<WorkspaceToolId, WorkspaceToolMeta> = {
  home: { id: "home", label: "Home", surfaceId: "home", icon: House },
  journal: { id: "journal", label: "Journal", surfaceId: "space", icon: Notebook },
  planner: { id: "planner", label: "Planner", surfaceId: "space", icon: CheckSquare2 },
  social: { id: "social", label: "Social", surfaceId: "space", icon: MessagesSquare },
  library: { id: "library", label: "Library", surfaceId: "space", icon: BookOpenText },
  inbox: { id: "inbox", label: "Inbox", surfaceId: "inbox", icon: Inbox },
  browser: { id: "browser", label: "Browser", surfaceId: "browser", icon: Globe2 },
  code: { id: "code", label: "Code", surfaceId: "code", icon: Code2 },
  files: { id: "files", label: "Files", surfaceId: "files", icon: FolderOpen },
  transfers: { id: "transfers", label: "Transfers", surfaceId: "transfers", icon: ArrowLeftRight },
  terminal: { id: "terminal", label: "Terminal", surfaceId: "terminal", icon: SquareTerminal },
  agents: { id: "agents", label: "Agents", surfaceId: "agents", icon: Bot },
  marketplace: {
    id: "marketplace",
    label: "Marketplace",
    surfaceId: "marketplace",
    icon: Blocks,
  },
};

export function isWorkspaceToolId(value: string): value is WorkspaceToolId {
  return Object.prototype.hasOwnProperty.call(WORKSPACE_TOOLS_META, value);
}

export const DEFAULT_RECENT_TOOLS: WorkspaceToolId[] = [
  "journal",
  "code",
  "terminal",
  "browser",
  "files",
];

export function toolIdFromTab(tab: Pick<WorkspaceTab, "surfaceId" | "route">): WorkspaceToolId {
  if (tab.surfaceId === "space") {
    const spaceTool = spaceWorkspaceToolFromRoute(tab.route);
    if (spaceTool === "planner" || spaceTool === "social" || spaceTool === "library") {
      return spaceTool;
    }
    return "journal";
  }
  return tab.surfaceId as WorkspaceToolId;
}

export function toolIdFromSurfaceId(
  surfaceId: WorkspaceSurfaceId,
  label?: string,
): WorkspaceToolId {
  if (surfaceId === "space") {
    const lower = (label ?? "").toLowerCase();
    if (lower.includes("planner")) return "planner";
    if (lower.includes("social") || lower.includes("chat")) return "social";
    if (lower.includes("library")) return "library";
    return "journal";
  }
  return surfaceId as WorkspaceToolId;
}

interface RecentToolsState {
  recentTools: WorkspaceToolId[];
  recordToolUsage: (toolId: WorkspaceToolId) => void;
  hydrateRecentTools: (toolIds: WorkspaceToolId[]) => void;
  resetRecentTools: () => void;
}

export const useRecentToolsStore = create<RecentToolsState>()(
  persist(
    (set) => ({
      recentTools: DEFAULT_RECENT_TOOLS,
      recordToolUsage: (toolId: WorkspaceToolId) => {
        if (!WORKSPACE_TOOLS_META[toolId]) return;
        set((state) => {
          const filtered = state.recentTools.filter((id) => id !== toolId);
          return { recentTools: [toolId, ...filtered].slice(0, 10) };
        });
        void homeApi.recordAppActivity(toolId).catch(() => undefined);
      },
      hydrateRecentTools: (toolIds: WorkspaceToolId[]) =>
        set({
          recentTools: [...new Set([...toolIds, ...DEFAULT_RECENT_TOOLS])].slice(0, 10),
        }),
      resetRecentTools: () => set({ recentTools: DEFAULT_RECENT_TOOLS }),
    }),
    {
      name: "misty-recent-tools",
      version: 2,
      migrate: (persisted) => {
        const state = persisted as Partial<RecentToolsState> | undefined;
        return {
          ...state,
          recentTools: (state?.recentTools ?? DEFAULT_RECENT_TOOLS).map((id) =>
            (id as string) === "chat" ? "social" : id,
          ),
        } as RecentToolsState;
      },
    },
  ),
);
