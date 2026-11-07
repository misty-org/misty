import { Download, History } from "lucide-react";
import {
  BrowserAgentsButton,
  BrowserPaneLayoutMenu,
  useBrowserToolbarSlot,
  useSidebarTools,
  type SidebarToolId,
} from "@/features/browser/workspace";
import { activeLayoutView, useWorkspaceStore } from "@/features/workspace";
import { browserInternalUrl } from "@/features/workspace/browserInternalUrl";
import { IconButton, toolbarIconProps } from "@/shared/ui";

const setToolsSlot = (element: HTMLDivElement | null) =>
  useBrowserToolbarSlot.getState().setTools(element);

const openPage = (page: "downloads" | "history") =>
  useWorkspaceStore.getState().openBrowserView({ url: browserInternalUrl(page) });

/**
 * The strip at the top of the address container, the same on every page: the tools pinned from
 * the ⋯ menu (pane layout and Agents to begin with), which belong to the window and not to a
 * page, then at the end the pinned extensions a browser page fills in. With nothing in it the
 * strip takes no room (`.misty-sidebar-tools`).
 */
export function SidebarToolsRow() {
  const viewId = useWorkspaceStore((state) => activeLayoutView(state.layout)?.id);
  const { pinned } = useSidebarTools();
  const tool = (id: SidebarToolId) => {
    if (!pinned.includes(id)) return null;
    if (id === "pane-layout")
      return viewId ? <BrowserPaneLayoutMenu key={id} tabId={viewId} /> : null;
    if (id === "agents") return <BrowserAgentsButton key={id} />;
    const Icon = id === "downloads" ? Download : History;
    return (
      <IconButton
        key={id}
        label={id === "downloads" ? "Downloads" : "History"}
        onClick={() => openPage(id)}
      >
        <Icon {...toolbarIconProps} className="size-4" />
      </IconButton>
    );
  };
  return (
    <div
      className="misty-sidebar-tools flex items-center gap-1.5"
      data-browser-toolbar
      data-sidebar
      data-misty-window-drag-block="true"
    >
      {tool("pane-layout")}
      {tool("agents")}
      {tool("downloads")}
      {tool("history")}
      <div ref={setToolsSlot} className="ml-auto flex items-center gap-1.5" />
    </div>
  );
}
