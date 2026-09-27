import { useMinimumSpin } from "@/shared/hooks/useMinimumSpin";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  IconButton,
  MenuItem,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/ui";
import {
  AppWindow,
  Check,
  Copy,
  Download,
  Eye,
  Folder,
  Grid2X2,
  List,
  Minus,
  MoreHorizontal,
  Plus,
  RefreshCcw,
} from "lucide-react";
import { memo, useCallback } from "react";
import type { ExplorerPaneToolbarActionsProps } from "../model/interfaces/components/ExplorerToolbarModel";
import { toolbarSortOptions } from "./ExplorerToolbarModel";
import { cx, paneToolbarActionStyles } from "@/features/file-ui";

export const ExplorerPaneToolbarActions = memo(function ExplorerPaneToolbarActions(
  props: ExplorerPaneToolbarActionsProps,
) {
  const [refreshSpinning, startRefreshSpin] = useMinimumSpin(false);
  const runRefresh = useCallback(() => {
    startRefreshSpin();
    props.onRefresh();
  }, [props, startRefreshSpin]);

  const canZoomOut = props.itemScale > 0;
  const canZoomIn = props.itemScale < 2;

  return (
    <>
      <div role="toolbar" aria-label="Layout" className={paneToolbarActionStyles.section}>
        <IconButton
          label="View as grid"
          className={cx(
            paneToolbarActionStyles.button,
            props.viewMode === "grid" && paneToolbarActionStyles.buttonActive,
          )}
          aria-pressed={props.viewMode === "grid"}
          onClick={() => props.onViewMode("grid")}
        >
          <Grid2X2 size={15} />
        </IconButton>
        <IconButton
          label="View as list"
          className={cx(
            paneToolbarActionStyles.button,
            props.viewMode === "list" && paneToolbarActionStyles.buttonActive,
          )}
          aria-pressed={props.viewMode === "list"}
          onClick={() => props.onViewMode("list")}
        >
          <List size={15} />
        </IconButton>
      </div>
      <div
        role="toolbar"
        aria-label="Item scale and file actions"
        className={paneToolbarActionStyles.section}
      >
        <IconButton
          label="Zoom out"
          className={paneToolbarActionStyles.button}
          disabled={!canZoomOut}
          onClick={() => props.onItemScale(props.itemScale - 1)}
        >
          <Minus size={15} />
        </IconButton>
        <IconButton
          label="Zoom in"
          className={paneToolbarActionStyles.button}
          disabled={!canZoomIn}
          onClick={() => props.onItemScale(props.itemScale + 1)}
        >
          <Plus size={15} />
        </IconButton>
        <DropdownMenu>
          <TooltipProvider delayDuration={450}>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    label="More file actions"
                    tooltip={false}
                    className={paneToolbarActionStyles.button}
                  >
                    <MoreHorizontal size={16} />
                  </IconButton>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>More file actions</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <DropdownMenuContent
            align="end"
            sideOffset={6}
            className="w-64"
            aria-label="More file actions"
          >
            <DropdownMenuLabel className="text-xs text-cream-muted">Sort</DropdownMenuLabel>
            {toolbarSortOptions.map((option) => {
              const active = props.sort.column === option.column;
              return (
                <DropdownMenuItem key={option.column} onSelect={() => props.onSort(option.column)}>
                  <Check className={active ? "opacity-100" : "opacity-0"} />
                  {option.label}
                  {active ? (
                    <DropdownMenuShortcut className="tracking-normal">
                      {props.sort.direction === "asc" ? "Asc" : "Desc"}
                    </DropdownMenuShortcut>
                  ) : null}
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuCheckboxItem
              checked={props.showHidden}
              onCheckedChange={() => props.onToggleHidden()}
            >
              <span className="flex items-center gap-2">
                <Eye className="size-4" />
                Show Hidden Files
              </span>
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-cream-muted">Location</DropdownMenuLabel>
            <MenuItem
              icon={<RefreshCcw className={refreshSpinning ? "animate-spin" : undefined} />}
              label="Refresh"
              onSelect={runRefresh}
            />
            <MenuItem
              icon={<Copy />}
              label="Copy Current Path"
              onSelect={() => props.onCopyPath(props.path)}
            />
            <MenuItem
              icon={<Folder />}
              label="Calculate Folder Sizes"
              disabled={!props.canCalculateDirectorySizes}
              onSelect={props.onCalculateDirectorySizes}
            />
            {props.selectedCount > 0 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-cream-muted">
                  {props.selectedCount === 1 ? "Selection" : `${props.selectedCount} Selected`}
                </DropdownMenuLabel>
                <MenuItem
                  icon={<AppWindow />}
                  label="Open With…"
                  disabled={!props.canOpenWithSelected}
                  onSelect={props.onOpenWith}
                />
                {props.hasRemoteSelection ? (
                  <MenuItem
                    icon={<Download />}
                    label="Save to Downloads"
                    onSelect={props.onDownload}
                  />
                ) : null}
                <MenuItem
                  icon={<Copy />}
                  label="Copy Selected Path"
                  disabled={props.selectedCount !== 1 || !props.selectedEntryPath}
                  onSelect={() => {
                    if (props.selectedEntryPath) props.onCopyPath(props.selectedEntryPath);
                  }}
                />
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
});
