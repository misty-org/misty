import {
  Button,
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/shared/ui";
import { Check, ExternalLink, Folder, PinOff, Plus, RefreshCcw, X } from "lucide-react";
import { ExplorerDropTarget } from "../../drag/ExplorerDropTarget";
import type { ExplorerSidebarProps } from "../../model/interfaces/components/ExplorerSidebar";
import { pinnedPathLabel, SidebarSectionHeader, sidebarStyles } from "../ExplorerSidebarSupport";
import type { useSidebarQuickAccess } from "./useSidebarQuickAccess";

/**
 * The Quick access section: platform folders, then the user's pinned paths.
 *
 * Both lists are drop targets and share one context menu, which is why they
 * live in a single section rather than two.
 */
export function SidebarQuickAccessSection({
  sidebar,
  collapsed,
  onToggle,
  quick,
}: {
  sidebar: ExplorerSidebarProps;
  collapsed: boolean;
  onToggle: () => void;
  quick: ReturnType<typeof useSidebarQuickAccess>;
}) {
  return (
    <section className={sidebarStyles.section}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div>
            <SidebarSectionHeader
              title="Quick access"
              collapsed={collapsed}
              onToggle={() => onToggle()}
              actions={
                sidebar.androidLocal ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Add local folder"
                    className={sidebarStyles.sectionActionButton}
                    onClick={(event) => {
                      event.stopPropagation();
                      sidebar.onGrantLocalFolder();
                    }}
                  >
                    <Plus size={15} />
                  </Button>
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
          <ContextMenuItem onSelect={quick.resetQuickAccessDefaults}>
            <RefreshCcw size={15} />
            <span>Reset Defaults</span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {!collapsed ? (
        <div className={sidebarStyles.list}>
          {quick.visibleQuickAccess.map((item) => {
            const Icon = item.icon;
            const grantedPath = item.grantRequest?.grantedPath;
            const selected = grantedPath
              ? sidebar.activePath === grantedPath ||
                sidebar.activePath.startsWith(`${grantedPath}/`)
              : sidebar.activePath === item.path;
            return (
              <ContextMenu key={`quick:${item.path}`}>
                <ContextMenuTrigger asChild>
                  <div
                    className={`${sidebarStyles.pinnedRow} ${selected ? sidebarStyles.itemSelected : ""}`}
                  >
                    <ExplorerDropTarget
                      id={`sidebar:quick:${item.path}`}
                      path={grantedPath ?? item.path}
                      springLoad={!item.grantRequest || Boolean(grantedPath)}
                      onSpringLoad={() => sidebar.onNavigate(grantedPath ?? item.path)}
                    >
                      <Button
                        type="button"
                        variant="ghost"
                        className={sidebarStyles.pinnedButton}
                        onClick={() => {
                          if (item.grantRequest) {
                            sidebar.onGrantLocalFolder(item.grantRequest);
                          } else {
                            sidebar.onNavigate(item.path);
                          }
                        }}
                      >
                        <span className={sidebarStyles.itemIcon} aria-hidden="true">
                          <Icon />
                        </span>
                        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                          {item.label}
                        </span>
                      </Button>
                    </ExplorerDropTarget>
                    {item.grantRequest && !grantedPath ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className={sidebarStyles.pinnedUnpinButton}
                        aria-label={`Grant access to ${item.label}`}
                        onClick={() => sidebar.onGrantLocalFolder(item.grantRequest)}
                      >
                        <Plus size={15} />
                      </Button>
                    ) : item.grantRequest ? (
                      <span
                        className={sidebarStyles.pinnedUnpinButton}
                        aria-label={`${item.label} access granted`}
                      >
                        <Check size={15} />
                      </span>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className={sidebarStyles.pinnedUnpinButton}
                        aria-label={`Unpin ${item.label} from Quick access`}
                        onClick={() => quick.hideQuickAccessPath(item.path)}
                      >
                        <PinOff size={15} />
                      </Button>
                    )}
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-56">
                  <ContextMenuItem onSelect={() => sidebar.onOpenInNewTab(item.path, item.label)}>
                    <ExternalLink size={15} />
                    <span>Open in New Tab</span>
                  </ContextMenuItem>
                  <ContextMenuItem
                    onSelect={() =>
                      quick.removeQuickAccessItem({
                        kind: "builtIn",
                        label: item.label,
                        path: item.path,
                      })
                    }
                  >
                    <X size={15} />
                    <span>Remove from Sidebar</span>
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onSelect={quick.resetQuickAccessDefaults}>
                    <RefreshCcw size={15} />
                    <span>Reset Defaults</span>
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
          {quick.visiblePinnedPaths.map((path) => (
            <ContextMenu key={`pin:${path}`}>
              <ContextMenuTrigger asChild>
                <div
                  className={`${sidebarStyles.pinnedRow} ${sidebar.activePath === path ? sidebarStyles.itemSelected : ""}`}
                >
                  <ExplorerDropTarget
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
                        <Folder />
                      </span>
                      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                        {pinnedPathLabel(path)}
                      </span>
                    </Button>
                  </ExplorerDropTarget>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className={sidebarStyles.pinnedUnpinButton}
                    aria-label={`Unpin ${path} from Quick access`}
                    onClick={() => sidebar.onUnpinPinnedPath(path)}
                  >
                    <PinOff size={15} />
                  </Button>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-56">
                <ContextMenuItem
                  onSelect={() => sidebar.onOpenInNewTab(path, pinnedPathLabel(path))}
                >
                  <ExternalLink size={15} />
                  <span>Open in New Tab</span>
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() =>
                    quick.removeQuickAccessItem({
                      kind: "pinned",
                      label: pinnedPathLabel(path),
                      path,
                    })
                  }
                >
                  <X size={15} />
                  <span>Remove from Sidebar</span>
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={quick.resetQuickAccessDefaults}>
                  <RefreshCcw size={15} />
                  <span>Reset Defaults</span>
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
        </div>
      ) : null}
    </section>
  );
}
