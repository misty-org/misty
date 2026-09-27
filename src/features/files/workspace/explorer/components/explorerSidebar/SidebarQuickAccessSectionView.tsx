import {
  Button,
  cn,
  Collapsible,
  CollapsibleContent,
  ContextMenu,
  ContextMenuAction,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuSeparator,
  ContextMenuTrigger,
  IconButton,
} from "@/shared/ui";
import { ExternalLink, Folder, PinOff, Plus, RefreshCcw, X } from "lucide-react";
import type { ExplorerSidebarProps } from "../../model/interfaces/components/ExplorerSidebar";
import { pinnedPathLabel, SidebarSectionHeader, sidebarStyles } from "@/features/file-ui";
import type { ExplorerSidebarRuntime } from "./ExplorerSidebarRuntime";
import type { useSidebarQuickAccess } from "./useSidebarQuickAccess";

/**
 * The Quick access section: platform folders, then the user's pinned paths.
 *
 * Both lists are drop targets and share one context menu, which is why they
 * live in a single section rather than two.
 */
export function SidebarQuickAccessSectionView({
  DropTarget,
  sidebar,
  collapsed,
  onToggle,
  quick,
}: {
  DropTarget: ExplorerSidebarRuntime["DropTarget"];
  sidebar: ExplorerSidebarProps;
  collapsed: boolean;
  onToggle: () => void;
  quick: ReturnType<typeof useSidebarQuickAccess>;
}) {
  return (
    <Collapsible className={sidebarStyles.section} open={!collapsed}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div>
            <SidebarSectionHeader
              title="Quick access"
              collapsed={collapsed}
              onToggle={() => onToggle()}
              actions={
                sidebar.onChooseFolder ? (
                  <IconButton
                    size="xs"
                    tooltip={false}
                    label="Add folder"
                    className={sidebarStyles.sectionActionButton}
                    onClick={(event) => {
                      event.stopPropagation();
                      sidebar.onChooseFolder?.();
                    }}
                  >
                    <Plus size={15} />
                  </IconButton>
                ) : undefined
              }
            />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56" aria-label="Quick access defaults">
          {quick.quickAccess.map((item) => (
            <ContextMenuCheckboxItem
              key={`quick-menu:${item.path}`}
              checked={!quick.isQuickAccessPathHidden(item.path)}
              onCheckedChange={() => quick.toggleQuickAccessDefault(item.path)}
              onSelect={(event) => event.preventDefault()}
            >
              {item.label}
            </ContextMenuCheckboxItem>
          ))}
          <ContextMenuSeparator />
          <ContextMenuAction
            icon={<RefreshCcw size={15} />}
            label="Reset Defaults"
            onSelect={quick.resetQuickAccessDefaults}
          />
        </ContextMenuContent>
      </ContextMenu>
      <CollapsibleContent>
        <div className={sidebarStyles.list}>
          {quick.visibleQuickAccess.map((item) => {
            const Icon = item.icon;

            const selected = sidebar.activePath === item.path;
            return (
              <ContextMenu key={`quick:${item.path}`}>
                <ContextMenuTrigger asChild>
                  <div className={sidebarStyles.treeRow}>
                    <div
                      className={cn(
                        sidebarStyles.treeSurface,
                        sidebarStyles.quickAccessSurface,
                        sidebarStyles.pinnedRow,
                        selected && sidebarStyles.itemSelected,
                      )}
                    >
                      <DropTarget
                        id={`sidebar:quick:${item.path}`}
                        path={item.path}
                        springLoad
                        onSpringLoad={() => sidebar.onNavigate(item.path)}
                      >
                        <Button
                          type="button"
                          variant="ghost"
                          className={sidebarStyles.pinnedButton}
                          onClick={() => {
                            sidebar.onNavigate(item.path);
                          }}
                        >
                          <span className={sidebarStyles.itemIcon} aria-hidden="true">
                            <Icon size={24} strokeWidth={1.9} />
                          </span>
                          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                            {item.label}
                          </span>
                        </Button>
                      </DropTarget>
                      {
                        <IconButton
                          label={`Unpin ${item.label} from Quick access`}
                          className={sidebarStyles.pinnedUnpinButton}
                          onClick={() => quick.hideQuickAccessPath(item.path)}
                        >
                          <PinOff size={15} />
                        </IconButton>
                      }
                    </div>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-56">
                  <ContextMenuAction
                    icon={<ExternalLink size={15} />}
                    label="Open in New Tab"
                    onSelect={() => sidebar.onOpenInNewTab(item.path, item.label)}
                  />
                  <ContextMenuAction
                    icon={<X size={15} />}
                    label="Remove from Sidebar"
                    onSelect={() =>
                      quick.removeQuickAccessItem({
                        kind: "builtIn",
                        label: item.label,
                        path: item.path,
                      })
                    }
                  />
                  <ContextMenuSeparator />
                  <ContextMenuAction
                    icon={<RefreshCcw size={15} />}
                    label="Reset Defaults"
                    onSelect={quick.resetQuickAccessDefaults}
                  />
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
          {quick.visiblePinnedPaths.map((path) => {
            return (
              <ContextMenu key={`pin:${path}`}>
                <ContextMenuTrigger asChild>
                  <div className={sidebarStyles.treeRow}>
                    <div
                      className={cn(
                        sidebarStyles.treeSurface,
                        sidebarStyles.quickAccessSurface,
                        sidebarStyles.pinnedRow,
                        sidebar.activePath === path && sidebarStyles.itemSelected,
                      )}
                    >
                      <DropTarget
                        id={`sidebar:pinned:${path}`}
                        path={path}
                        springLoad
                        onSpringLoad={() => sidebar.onNavigate(path)}
                      >
                        <Button
                          type="button"
                          variant="ghost"
                          className={sidebarStyles.pinnedButton}
                          onClick={() => sidebar.onNavigate(path)}
                        >
                          <span className={sidebarStyles.itemIcon} aria-hidden="true">
                            <Folder size={24} strokeWidth={1.9} />
                          </span>
                          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                            {pinnedPathLabel(path)}
                          </span>
                        </Button>
                      </DropTarget>
                      <IconButton
                        label={`Unpin ${path} from Quick access`}
                        className={sidebarStyles.pinnedUnpinButton}
                        onClick={() => sidebar.onUnpinPinnedPath(path)}
                      >
                        <PinOff size={15} />
                      </IconButton>
                    </div>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-56">
                  <ContextMenuAction
                    icon={<ExternalLink size={15} />}
                    label="Open in New Tab"
                    onSelect={() => sidebar.onOpenInNewTab(path, pinnedPathLabel(path))}
                  />
                  <ContextMenuAction
                    icon={<X size={15} />}
                    label="Remove from Sidebar"
                    onSelect={() =>
                      quick.removeQuickAccessItem({
                        kind: "pinned",
                        label: pinnedPathLabel(path),
                        path,
                      })
                    }
                  />
                  <ContextMenuSeparator />
                  <ContextMenuAction
                    icon={<RefreshCcw size={15} />}
                    label="Reset Defaults"
                    onSelect={quick.resetQuickAccessDefaults}
                  />
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
