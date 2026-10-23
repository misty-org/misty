import { useMinimumSpin } from "@/shared/hooks/useMinimumSpin";
import { breadcrumbSegments } from "@/shared/lib/fileFormat";
import { Button, cn, IconButton, Input } from "@/shared/ui";
import { ArrowUp, ChevronLeft, ChevronRight, RefreshCcw, Search, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
const toolbarStyles = {
  root: cn(
    "min-w-0 overflow-visible bg-charcoal-sidebar text-cream",
    "max-[720px]:overflow-x-auto max-[720px]:overflow-y-hidden",
    "max-[720px]:[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
  ),
  navRow: cn(
    "grid min-h-14 min-w-0 grid-cols-[auto_minmax(240px,1fr)_auto]",
    "items-center gap-2 overflow-visible px-3 py-2",
    "max-[980px]:grid-cols-[auto_minmax(180px,1fr)_auto]",
  ),
  navButtons: "flex min-w-0 flex-none items-center gap-1",
  navigationButton: "size-8 rounded-md text-cream-muted shadow-none",
  pathBar: cn(
    "flex h-9 min-w-0 items-center gap-0.5 overflow-x-auto overflow-y-hidden",
    "rounded-md border border-charcoal-border bg-charcoal-card px-1.5",
    "shadow-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
  ),
  pathBarEditing: "border-charcoal-border",
  pathButton:
    "h-7 min-w-fit flex-none gap-0 rounded-sm px-1.5 text-sm font-normal text-cream shadow-none",
  pathInput: cn(
    "h-full min-w-0 w-full appearance-none rounded-none border-0",
    "bg-transparent p-0 font-[inherit] leading-none text-cream shadow-none",
    "outline-none ring-0 focus-visible:ring-0 placeholder:text-cream-muted",
  ),
  breadcrumbCaret: "mr-1.5 flex-none text-cream-muted/70",
  commandSearch:
    "flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-charcoal-border " +
    "bg-charcoal-card px-1.5 text-cream-muted shadow-none max-[980px]:w-full max-[720px]:min-w-40",
  searchButton: "size-8 shrink-0 rounded-md text-cream-muted",
  commandInput: cn(
    "h-full min-w-0 flex-1 appearance-none rounded-none border-0",
    "bg-transparent p-0 text-cream shadow-none outline-none ring-0",
    "focus-visible:ring-0 placeholder:text-cream-muted",
  ),
} as const;

/** Back, forward, parent, refresh, an editable path and a filter for the folder's contents. */
export function PickerToolbar(props: PickerToolbarProps) {
  const [pathEditing, setPathEditing] = useState(false);
  const [pathDraft, setPathDraft] = useState(props.path);
  const pathInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [refreshSpinning, startRefreshSpin] = useMinimumSpin(false);

  useEffect(() => {
    if (!pathEditing) setPathDraft(props.path);
  }, [pathEditing, props.path]);

  useLayoutEffect(() => {
    if (!pathEditing) return;
    pathInputRef.current?.focus();
    pathInputRef.current?.select();
  }, [pathEditing]);

  const beginPathEdit = useCallback(() => {
    setPathDraft(props.path);
    setPathEditing(true);
  }, [props.path]);

  const cancelPathEdit = useCallback(() => {
    setPathEditing(false);
    setPathDraft(props.path);
  }, [props.path]);

  const submitPathEdit = useCallback(() => {
    const target = pathDraft.trim();
    setPathEditing(false);
    setPathDraft(props.path);
    if (target) props.onNavigate(target);
  }, [pathDraft, props]);

  return (
    <header className={toolbarStyles.root}>
      <div className={toolbarStyles.navRow}>
        <div className={toolbarStyles.navButtons} role="group" aria-label="Navigation">
          <IconButton
            size="md"
            label="Back"
            className={toolbarStyles.navigationButton}
            disabled={!props.canGoBack}
            onClick={props.onBack}
          >
            <ChevronLeft size={18} />
          </IconButton>
          <IconButton
            size="md"
            label="Forward"
            className={toolbarStyles.navigationButton}
            disabled={!props.canGoForward}
            onClick={props.onForward}
          >
            <ChevronRight size={18} />
          </IconButton>
          <IconButton
            size="md"
            label="Parent folder"
            className={toolbarStyles.navigationButton}
            disabled={!props.canGoParent}
            onClick={props.onParent}
          >
            <ArrowUp size={18} />
          </IconButton>
          <IconButton
            size="md"
            label="Refresh current folder"
            className={toolbarStyles.navigationButton}
            onClick={() => {
              startRefreshSpin();
              props.onRefresh();
            }}
          >
            <RefreshCcw className={refreshSpinning ? "animate-spin" : undefined} size={17} />
          </IconButton>
        </div>

        <div
          className={cn(toolbarStyles.pathBar, pathEditing && toolbarStyles.pathBarEditing)}
          title={pathEditing ? undefined : "Double-click to edit path"}
          onDoubleClick={beginPathEdit}
        >
          {pathEditing ? (
            <Input
              ref={pathInputRef}
              className={toolbarStyles.pathInput}
              value={pathDraft}
              placeholder="Enter file path"
              spellCheck={false}
              onChange={(event) => setPathDraft(event.target.value)}
              onBlur={cancelPathEdit}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitPathEdit();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  cancelPathEdit();
                }
              }}
            />
          ) : (
            breadcrumbSegments(props.path).map((segment, index) => (
              <Button
                key={`${segment.path}-${index}`}
                className={toolbarStyles.pathButton}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => props.onNavigate(segment.path)}
              >
                {index > 0 ? (
                  <ChevronRight className={toolbarStyles.breadcrumbCaret} size={14} />
                ) : null}
                {segment.label}
              </Button>
            ))
          )}
        </div>

        <label className={`${toolbarStyles.commandSearch} w-[min(260px,28vw)]`}>
          <Search className="shrink-0" size={17} />
          <Input
            ref={searchInputRef}
            className={toolbarStyles.commandInput}
            type="search"
            value={props.query}
            placeholder="Search this folder"
            aria-label="Search this folder"
            spellCheck={false}
            onChange={(event) => props.onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && props.query) {
                event.preventDefault();
                event.stopPropagation();
                props.onQueryChange("");
              }
            }}
          />
          {props.query ? (
            <IconButton
              label="Clear search"
              className={toolbarStyles.searchButton}
              onClick={() => {
                props.onQueryChange("");
                searchInputRef.current?.focus();
              }}
            >
              <X size={14} />
            </IconButton>
          ) : null}
        </label>
      </div>
    </header>
  );
}

export interface PickerToolbarProps {
  path: string;
  query: string;
  canGoBack: boolean;
  canGoForward: boolean;
  canGoParent: boolean;
  onBack: () => void;
  onForward: () => void;
  onParent: () => void;
  onNavigate: (path: string) => void;
  onRefresh: () => void;
  onQueryChange: (query: string) => void;
}
