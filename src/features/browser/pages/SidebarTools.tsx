import { resolveSetting, useDevicePreferences } from "@/features/settings";
import {
  AppWindow,
  BookOpenText,
  Download,
  History,
  KeyRound,
  PictureInPicture2,
  Pin,
  Plus,
  Printer,
  Search,
  VenetianMask,
  type LucideIcon,
} from "lucide-react";

const settingId = "app.sidebar.tools";

/** An internal page a tool opens. */
type ToolPage = "downloads" | "history" | "passwords";

export interface SidebarToolDefinition {
  id: string;
  label: string;
  icon?: LucideIcon;
  /** The shortcut command the button runs, for tools that act on the focused page or window. */
  command?: string;
  /** The internal page the button opens. */
  page?: ToolPage;
}

/** What the toolbar at the sidebar's foot can hold, in the order it draws them. Any row of the ⋯
 * menu that runs a command or opens a page can be pinned here. */
export const sidebarTools = [
  { id: "pane-layout", label: "Pane layout" },
  { id: "agents", label: "Agents" },
  { id: "new-tab", label: "New tab", icon: Plus, command: "search.toggle" },
  { id: "new-window", label: "New window", icon: AppWindow, command: "workspace.new_window" },
  {
    id: "new-incognito",
    label: "New incognito window",
    icon: VenetianMask,
    command: "workspace.new_incognito_window",
  },
  { id: "downloads", label: "Downloads", icon: Download, page: "downloads" },
  { id: "history", label: "History", icon: History, page: "history" },
  { id: "passwords", label: "Passwords", icon: KeyRound, page: "passwords" },
  { id: "find", label: "Find", icon: Search, command: "browser.find" },
  { id: "reader", label: "Reader view", icon: BookOpenText, command: "browser.reader_mode" },
  {
    id: "pip",
    label: "Picture in picture",
    icon: PictureInPicture2,
    command: "browser.picture_in_picture",
  },
  { id: "print", label: "Print", icon: Printer, command: "browser.print" },
] as const satisfies readonly SidebarToolDefinition[];

export type SidebarToolId = (typeof sidebarTools)[number]["id"];

const known = new Set<string>(sidebarTools.map((tool) => tool.id));

/** The pinned tools in the stored value, dropping anything this build doesn't know. */
export function parsePinnedTools(raw: string): SidebarToolId[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is SidebarToolId => typeof id === "string" && known.has(id))
      : [];
  } catch {
    return [];
  }
}

/** The tools pinned to this device's sidebar row, and a way to pin or unpin one. */
export function useSidebarTools() {
  const raw = useDevicePreferences((store) =>
    store.state ? String(resolveSetting(store.state, settingId).value) : null,
  );
  const edit = useDevicePreferences((store) => store.edit);
  const pinned = parsePinnedTools(raw ?? '["pane-layout","agents"]');
  const toggle = (id: SidebarToolId, on: boolean) => {
    const next = sidebarTools
      .map((tool) => tool.id)
      .filter((tool) => (tool === id ? on : pinned.includes(tool)));
    return edit(settingId, JSON.stringify(next));
  };
  return { pinned, toggle };
}

/**
 * What a ⋯ menu row needs to be pinnable: a right-click pins it to the toolbar at the sidebar's
 * foot, or takes it off again, and a pinned row shows a pin where its shortcut sits.
 */
export function usePinnableRow(id: SidebarToolId | undefined) {
  const { pinned, toggle } = useSidebarTools();
  const isPinned = id !== undefined && pinned.includes(id);
  return {
    /** Shown beside the row's shortcut while it is pinned. */
    mark: isPinned ? <Pin className="size-3" aria-label="Pinned to toolbar" /> : null,
    title: id
      ? isPinned
        ? "Right-click to unpin from toolbar"
        : "Right-click to pin to toolbar"
      : undefined,
    onContextMenu: id
      ? (event: { preventDefault(): void }) => {
          event.preventDefault();
          void toggle(id, !isPinned).catch(() => undefined);
        }
      : undefined,
  };
}
