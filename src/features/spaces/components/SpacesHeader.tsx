import { Plus } from "lucide-react";
import { ChromeTabStrip } from "@/features/workspace";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/ui";
import type {
  SpacesTab,
  SpacesTabsSession,
  WorkspaceTabKind,
} from "@/stores/spaces/useSpacesTabsStore";
import { SpacesUtilityTray, workspaceToolDefinitions } from "./SpacesUtilityTray";

export function SpacesHeader(props: {
  session: SpacesTabsSession | undefined;
  onOpenTool: (kind: WorkspaceTabKind) => void;
  onCloseTab: (tabId: string) => void;
  onReorderTab: (tabId: string, fromIndex: number, toIndex: number) => void;
  onSelectTab: (tabId: string) => void;
  onRenameTab: (tabId: string, title: string) => void;
}) {
  const tabs = props.session?.tabs ?? [];
  // Only File Manager tabs own their title; a Space tab's comes from its route.
  const renameableTabIds = new Set(
    tabs.filter((tab) => tab.kind === "file-manager").map((tab) => tab.id),
  );
  return (
    <header className="h-[46px] min-w-0 border-b border-charcoal-border/45 bg-charcoal-bg">
      <ChromeTabStrip
        tabs={tabs.map(tabDescriptor)}
        activeTabId={props.session?.activeTabId ?? ""}
        ariaLabel="Open workspace tools"
        addTabControl={<NewWorkspaceTabMenu onOpenTool={props.onOpenTool} />}
        actions={<SpacesUtilityTray onOpenTool={props.onOpenTool} />}
        canCloseTab={() => true}
        canRenameTab={(tab) => renameableTabIds.has(tab.id)}
        onAddTab={() => undefined}
        onCloseTab={(tab) => props.onCloseTab(tab.id)}
        onRenameTab={props.onRenameTab}
        onReorderTab={props.onReorderTab}
        onSelectTab={props.onSelectTab}
      />
    </header>
  );
}

function NewWorkspaceTabMenu(props: { onOpenTool: (kind: WorkspaceTabKind) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          className="misty-chrome-tabs-add"
          title="New tab"
          aria-label="New tab"
        >
          <Plus size={17} strokeWidth={2.4} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Open a new tab</DropdownMenuLabel>
        {workspaceToolDefinitions.map(({ kind, label, description, icon: Icon }) => (
          <DropdownMenuItem
            key={kind}
            className="items-start py-2"
            onSelect={() => props.onOpenTool(kind)}
          >
            <Icon className="mt-0.5 size-4" strokeWidth={1.8} />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{label}</span>
              <span className="block text-xs text-cream-muted">{description}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function tabDescriptor(tab: SpacesTab) {
  return {
    id: tab.id,
    title: tab.kind === "space" ? spaceTabTitle(tab.route) : tab.title,
    path: tab.kind === "space" ? tab.route : `misty-workspace://${tab.kind}/${tab.id}`,
    paneId: tab.id,
  };
}

function spaceTabTitle(route: string): string {
  const section = route.split(/[/?#]/).filter(Boolean)[2] ?? "space";
  if (section === "notes" || section === "drawings") return "Journal";
  if (section === "planner") return "Planner";
  if (section === "chat") return "Chat";
  if (section === "library") return "Library";
  if (section === "settings") return "Settings";
  return "Space";
}
