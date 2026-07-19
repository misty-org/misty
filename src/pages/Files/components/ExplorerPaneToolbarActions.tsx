import { IconButton, Toolbar } from "../../../components/misty";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../../components/ui/tooltip";
import {
  AppWindow,
  Check,
  Copy,
  Download,
  Eye,
  Folder,
  Grid2X2,
  List,
  MoreHorizontal,
  RefreshCcw,
} from "lucide-react";
import { memo, useCallback } from "react";
import { useMinimumSpin } from "../../../shared/hooks/useMinimumSpin";
import {
  toolbarSortOptions,
  type ExplorerPaneToolbarActionsProps,
} from "./ExplorerToolbarModel";
import { cx, paneToolbarActionStyles } from "./ExplorerToolbarSupport";

export const ExplorerPaneToolbarActions = memo(function ExplorerPaneToolbarActions(
  props: ExplorerPaneToolbarActionsProps,
) {
  const [refreshSpinning, startRefreshSpin] = useMinimumSpin(false);
  const runRefresh = useCallback(() => {
    startRefreshSpin();
    props.onRefresh();
  }, [props.onRefresh, startRefreshSpin]);

  return (
    <Toolbar
      variant="bare"
      label="View and file actions"
      className={paneToolbarActionStyles.section}
    >
      <IconButton
        size="sm"
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
        size="sm"
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
      <DropdownMenu>
        <TooltipProvider delayDuration={450}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <IconButton
                  size="sm"
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
          <DropdownMenuLabel className="text-xs text-muted-foreground">View</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={props.viewMode}
            onValueChange={(value) => props.onViewMode(value as "grid" | "list")}
          >
            <DropdownMenuRadioItem value="grid">
              <Grid2X2 />
              View as Grid
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="list">
              <List />
              View as List
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground">Sort</DropdownMenuLabel>
          {toolbarSortOptions.map((option) => {
            const active = props.sort.column === option.column;
            return (
              <DropdownMenuItem key={option.column} onSelect={() => props.onSort(option.column)}>
                <Check className={active ? "opacity-100" : "opacity-0"} />
                Sort by {option.label}
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
          <DropdownMenuLabel className="text-xs text-muted-foreground">Location</DropdownMenuLabel>
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
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {props.selectedCount === 1 ? "Selection" : `${props.selectedCount} Selected`}
              </DropdownMenuLabel>
              <DropdownMenuItem
                disabled={!props.canOpenWithSelected}
                onSelect={props.onOpenWith}
              >
                <AppWindow />
                Open With…
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!props.hasRemoteSelection}
                onSelect={props.onDownload}
              >
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
    </Toolbar>
  );
});
