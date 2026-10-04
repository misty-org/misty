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
import { SidebarSectionHeader, sidebarStyles } from "@/features/file-ui";
import { usePointerReorder } from "@/shared/hooks/usePointerReorder";
import type { ExplorerSidebarRuntime } from "./ExplorerSidebarRuntime";
import type { useSidebarQuickAccess } from "./useSidebarQuickAccess";

/**
 * The Quick access section: platform folders, then the user's pinned paths.
 *
 * Both kinds are drop targets, share one context menu and reorder together by
 * dragging, which is why they live in a single list rather than two.
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
  const reorder = usePointerReorder({
    scope: "explorer-quick-access",
    axis: "y",
    animate: true,
    getDrag: (id) => {
      const row = quick.rows.find((candidate) => candidate.path === id);
      return row ? { id, label: row.label } : null;
    },
    onDrop: (drag, target, after) => quick.moveQuickAccessRow(drag.id, target, after),
    onKeyboardMove: (id, direction) => {
      const index = quick.rows.findIndex((row) => row.path === id);
      const target = quick.rows[index + direction];
      if (target) quick.moveQuickAccessRow(id, target.path, direction === 1);
    },
  });
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
        <div {...reorder} className={sidebarStyles.list}>
          {quick.rows.map((row) => {
            const Icon = row.kind === "builtIn" ? row.icon : Folder;
            return (
              <ContextMenu key={`${row.kind}:${row.path}`}>
                <ContextMenuTrigger asChild>
                  <div
                    className={sidebarStyles.treeRow}
                    data-reorder-item={row.path}
                    data-reorder-preview="true"
                  >
                    {/* The drag captures the pointer on this row, so clicks land here,
                        not on the button; the button's own click bubbles up too. */}
                    <div
                      data-reorder-handle="true"
                      onClick={(event) => {
                        if (!(event.target as Element).closest("[data-reorder-ignore]"))
                          sidebar.onNavigate(row.path);
                      }}
                      className={cn(
                        sidebarStyles.treeSurface,
                        sidebarStyles.quickAccessSurface,
                        sidebarStyles.pinnedRow,
                        sidebar.activePath === row.path && sidebarStyles.itemSelected,
                      )}
                    >
                      <DropTarget
                        id={`sidebar:${row.kind === "builtIn" ? "quick" : "pinned"}:${row.path}`}
                        path={row.path}
                        springLoad
                        onSpringLoad={() => sidebar.onNavigate(row.path)}
                      >
                        <Button
                          type="button"
                          variant="ghost"
                          className={sidebarStyles.pinnedButton}
                        >
                          <span className={sidebarStyles.itemIcon} aria-hidden="true">
                            <Icon size={24} strokeWidth={1.9} />
                          </span>
                          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                            {row.label}
                          </span>
                        </Button>
                      </DropTarget>
                      <IconButton
                        data-reorder-ignore="true"
                        label={`Unpin ${row.kind === "builtIn" ? row.label : row.path} from Quick access`}
                        className={sidebarStyles.pinnedUnpinButton}
                        onClick={() =>
                          row.kind === "builtIn"
                            ? quick.hideQuickAccessPath(row.path)
                            : sidebar.onUnpinPinnedPath(row.path)
                        }
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
                    onSelect={() => sidebar.onOpenInNewTab(row.path, row.label)}
                  />
                  <ContextMenuAction
                    icon={<X size={15} />}
                    label="Remove from Sidebar"
                    onSelect={() =>
                      quick.removeQuickAccessItem({
                        kind: row.kind,
                        label: row.label,
                        path: row.path,
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
