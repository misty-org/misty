import { Button } from "@/ui";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/ui";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/ui";
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
import { useMinimumSpin } from "@/hooks/useMinimumSpin";
import { toolbarSortOptions } from "./ExplorerToolbarModel";
import type { ExplorerPaneToolbarActionsProps } from "@/models/interfaces/features/explorer/components/ExplorerToolbarModel";
import { cx, paneToolbarActionStyles } from "./ExplorerToolbarSupport";

export const ExplorerPaneToolbarActions = memo(function ExplorerPaneToolbarActions(
  props: ExplorerPaneToolbarActionsProps,
) {
  const [refreshSpinning, startRefreshSpin] = useMinimumSpin(false);
  const runRefresh = useCallback(() => {
    startRefreshSpin();
    props.onRefresh();
  }, [props.onRefresh, startRefreshSpin]);

  const canZoomOut = props.itemScale > 0;
  const canZoomIn = props.itemScale < 2;

  return (
    <>
      <div role="toolbar" aria-label="Layout" className={paneToolbarActionStyles.section}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="View as grid"
          title="View as grid"
          className={cx(
            paneToolbarActionStyles.button,
            props.viewMode === "grid" && paneToolbarActionStyles.buttonActive,
          )}
          aria-pressed={props.viewMode === "grid"}
          onClick={() => props.onViewMode("grid")}
        >
          <Grid2X2 size={15} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="View as list"
          title="View as list"
          className={cx(
            paneToolbarActionStyles.button,
            props.viewMode === "list" && paneToolbarActionStyles.buttonActive,
          )}
          aria-pressed={props.viewMode === "list"}
          onClick={() => props.onViewMode("list")}
        >
          <List size={15} />
        </Button>
      </div>
      <div
        role="toolbar"
        aria-label="Item scale and file actions"
        className={paneToolbarActionStyles.section}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Zoom out"
          title="Zoom out"
          className={paneToolbarActionStyles.button}
          disabled={!canZoomOut}
          onClick={() => props.onItemScale(props.itemScale - 1)}
        >
          <Minus size={15} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Zoom in"
          title="Zoom in"
          className={paneToolbarActionStyles.button}
          disabled={!canZoomIn}
          onClick={() => props.onItemScale(props.itemScale + 1)}
        >
          <Plus size={15} />
        </Button>
        <DropdownMenu>
          <TooltipProvider delayDuration={450}>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="More file actions"
                    className={paneToolbarActionStyles.button}
                  >
                    <MoreHorizontal size={16} />
                  </Button>
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
            <DropdownMenuItem onSelect={runRefresh}>
              <RefreshCcw className={refreshSpinning ? "animate-spin" : undefined} />
              Refresh
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => props.onCopyPath(props.path)}>
              <Copy />
              Copy Current Path
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!props.canCalculateDirectorySizes}
              onSelect={props.onCalculateDirectorySizes}
            >
              <Folder />
              Calculate Folder Sizes
            </DropdownMenuItem>
            {props.selectedCount > 0 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-cream-muted">
                  {props.selectedCount === 1 ? "Selection" : `${props.selectedCount} Selected`}
                </DropdownMenuLabel>
                <DropdownMenuItem disabled={!props.canOpenWithSelected} onSelect={props.onOpenWith}>
                  <AppWindow />
                  Open With…
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!props.hasRemoteSelection} onSelect={props.onDownload}>
                  <Download />
                  Download
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={props.selectedCount !== 1 || !props.selectedEntryPath}
                  onSelect={() => {
                    if (props.selectedEntryPath) props.onCopyPath(props.selectedEntryPath);
                  }}
                >
                  <Copy />
                  Copy Selected Path
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
});
