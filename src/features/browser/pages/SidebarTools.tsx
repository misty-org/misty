import { resolveSetting, useDevicePreferences } from "@/features/settings";
import { DropdownMenuCheckboxItem, MenuSubmenu } from "@/shared/ui";
import { Pin } from "lucide-react";

const settingId = "app.sidebar.tools";

/** What the sidebar's tools row can hold, in the order it draws them. Only tools that work on
 * any page belong here: a page's own tools (reader, translate) stay in the ⋯ menu. */
export const sidebarTools = [
  { id: "pane-layout", label: "Pane layout" },
  { id: "agents", label: "Agents" },
  { id: "downloads", label: "Downloads" },
  { id: "history", label: "History" },
] as const;

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

/** A ⋯ menu's "Pin to toolbar" submenu: a checkmark on each tool in the sidebar's tools row. */
export function SidebarToolsPinMenu() {
  const { pinned, toggle } = useSidebarTools();
  return (
    <MenuSubmenu icon={<Pin />} label="Pin to toolbar">
      {sidebarTools.map((tool) => (
        <DropdownMenuCheckboxItem
          key={tool.id}
          checked={pinned.includes(tool.id)}
          onSelect={(event) => event.preventDefault()}
          onCheckedChange={(on) => void toggle(tool.id, on).catch(() => undefined)}
        >
          {tool.label}
        </DropdownMenuCheckboxItem>
      ))}
    </MenuSubmenu>
  );
}
